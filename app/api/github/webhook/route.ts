import { createHash } from "node:crypto";
import { env } from "@/lib/config/env";
import { verifyWebhookSignature } from "@/lib/seo/webhook-signature";
import { requireAdminDb } from "@/lib/automation/control-plane";
import { sanitizeWebhookPayload } from "@/lib/security/webhook-payload";
import { logEvent,safeError } from "@/lib/api/errors";
import {claimWebhookEvent,completeWebhookEvent,failWebhookEvent,requireWebhookMutation} from "@/lib/webhooks/inbox";

type GitHubPayload={action?:string;installation?:{id?:number;suspended_at?:string|null;account?:{id?:number;login?:string;type?:string};repository_selection?:string;permissions?:Record<string,string>;events?:string[]};repository?:{id?:number;name?:string;full_name?:string;default_branch?:string;owner?:{login?:string}};repositories_added?:Array<{id:number}>;repositories_removed?:Array<{id:number}>;pull_request?:{number?:number;merged?:boolean;merge_commit_sha?:string};after?:string};

export async function POST(request:Request){
  const raw=await request.text(),delivery=request.headers.get("x-github-delivery"),eventType=request.headers.get("x-github-event")??"unknown",signature=request.headers.get("x-hub-signature-256");
  if(!delivery||!env.GITHUB_WEBHOOK_SECRET||!verifyWebhookSignature(raw,signature,env.GITHUB_WEBHOOK_SECRET,"sha256="))return Response.json({ok:false,error:"invalid_signature"},{status:401});
  let payload:GitHubPayload;try{payload=JSON.parse(raw) as GitHubPayload}catch{return Response.json({ok:false,error:"invalid_json"},{status:400})}
  const db=requireAdminDb(),installationId=payload.installation?.id,installation=installationId?await db.from("github_installations").select("id,agency_id").eq("installation_id",installationId).maybeSingle():null,payloadHash=createHash("sha256").update(raw).digest("hex");let inbox:{eventId:string;duplicate:boolean;replayed:boolean};try{inbox=await claimWebhookEvent(db,{provider:"github",deliveryId:delivery,agencyId:installation?.data?.agency_id??null,eventType,action:payload.action??null,payloadHash,payload:sanitizeWebhookPayload(payload)});}catch(error){const safe=safeError(error);return Response.json({ok:false,error:safe.body.error},{status:safe.status});}
  if(inbox.duplicate)return Response.json({ok:true,duplicate:true});
  const eventId=inbox.eventId,now=new Date().toISOString();
  try{
    if(eventType==="installation"&&installationId&&payload.installation?.account?.id&&payload.installation.account.login){
      const status=payload.action==="deleted"?"deleted":payload.installation.suspended_at||payload.action==="suspend"?"suspended":"active";
      requireWebhookMutation(await db.from("github_installations").update({status,suspended_at:status==="suspended"?(payload.installation.suspended_at??now):null,permissions:payload.installation.permissions??{},events:payload.installation.events??[],updated_at:now}).eq("installation_id",installationId),"The GitHub installation state could not be updated.");
      if(status!=="active"&&installation?.data)requireWebhookMutation(await db.from("repositories").update({status:status==="deleted"?"disabled":"installation_suspended",updated_at:now}).eq("github_installation_id",installation.data.id),"Repository access could not be suspended.");
    }
    if(eventType==="installation_repositories"&&installation?.data){
      const removed=(payload.repositories_removed??[]).map(item=>item.id);if(removed.length)requireWebhookMutation(await db.from("repositories").update({status:"disabled",updated_at:now}).eq("github_installation_id",installation.data.id).in("github_repository_id",removed),"Removed GitHub repositories could not be disabled.");
      const added=(payload.repositories_added??[]).map(item=>item.id);if(added.length)requireWebhookMutation(await db.from("repositories").update({status:"active",updated_at:now}).eq("github_installation_id",installation.data.id).in("github_repository_id",added),"Added GitHub repositories could not be enabled.");
    }
    if(eventType==="pull_request"&&payload.action==="closed"&&payload.pull_request?.merged&&payload.pull_request.number){
      const legacyConnection=await db.from("repository_connections").select("id").eq("repository_owner",payload.repository?.owner?.login??"").eq("repository_name",payload.repository?.name??"").maybeSingle();
      if(legacyConnection.data){const execution=await db.from("seo_executions").select("id,agency_id,project_id").eq("repository_connection_id",legacyConnection.data.id).eq("pull_request_number",payload.pull_request.number).maybeSingle();if(execution.data){requireWebhookMutation(await db.from("seo_executions").update({status:"merged",merge_commit_sha:payload.pull_request.merge_commit_sha,merged_at:now}).eq("id",execution.data.id),"The merged SEO execution could not be recorded.");logEvent("github_pr_merged",{executionId:execution.data.id,agencyId:execution.data.agency_id,projectId:execution.data.project_id,status:"merged"});}}
    }
    requireWebhookMutation(await db.from("webhook_deliveries").upsert({provider:"github",delivery_id:delivery,event_type:eventType,signature_valid:true,payload_hash:payloadHash,processed_at:now},{onConflict:"provider,delivery_id"}),"The GitHub delivery receipt could not be stored.");
    await completeWebhookEvent(db,{eventId,status:"processed"});
    return Response.json({ok:true,replayed:inbox.replayed});
  }catch(error){const safe=safeError(error);await failWebhookEvent(db,{eventId,code:safe.body.error.code,message:safe.body.error.message});return Response.json({ok:false,error:safe.body.error},{status:safe.status})}
}
