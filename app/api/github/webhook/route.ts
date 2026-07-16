import { createHash } from "node:crypto";
import { env } from "@/lib/config/env";
import { verifyWebhookSignature } from "@/lib/seo/webhook-signature";
import { requireAdminDb } from "@/lib/automation/control-plane";
import { sanitizeWebhookPayload } from "@/lib/security/webhook-payload";
import { logEvent } from "@/lib/api/errors";

type GitHubPayload={action?:string;installation?:{id?:number;suspended_at?:string|null;account?:{id?:number;login?:string;type?:string};repository_selection?:string;permissions?:Record<string,string>;events?:string[]};repository?:{id?:number;name?:string;full_name?:string;default_branch?:string;owner?:{login?:string}};repositories_added?:Array<{id:number}>;repositories_removed?:Array<{id:number}>;pull_request?:{number?:number;merged?:boolean;merge_commit_sha?:string};after?:string};

export async function POST(request:Request){
  const raw=await request.text(),delivery=request.headers.get("x-github-delivery"),eventType=request.headers.get("x-github-event")??"unknown",signature=request.headers.get("x-hub-signature-256");
  if(!delivery||!env.GITHUB_WEBHOOK_SECRET||!verifyWebhookSignature(raw,signature,env.GITHUB_WEBHOOK_SECRET,"sha256="))return Response.json({ok:false,error:"invalid_signature"},{status:401});
  let payload:GitHubPayload;try{payload=JSON.parse(raw) as GitHubPayload}catch{return Response.json({ok:false,error:"invalid_json"},{status:400})}
  const db=requireAdminDb(),installationId=payload.installation?.id,installation=installationId?await db.from("github_installations").select("id,agency_id").eq("installation_id",installationId).maybeSingle():null;
  const inserted=await db.from("webhook_events").insert({provider:"github",delivery_id:delivery,agency_id:installation?.data?.agency_id??null,event_type:eventType,action:payload.action??null,payload_hash:createHash("sha256").update(raw).digest("hex"),payload:sanitizeWebhookPayload(payload),signature_valid:true,status:"processing",attempt_count:1}).select("id").single();
  if(inserted.error){if(inserted.error.code==="23505")return Response.json({ok:true,duplicate:true});return Response.json({ok:false,error:"event_store_failed"},{status:500})}
  const eventId=inserted.data.id,now=new Date().toISOString();
  try{
    if(eventType==="installation"&&installationId&&payload.installation?.account?.id&&payload.installation.account.login){
      const status=payload.action==="deleted"?"deleted":payload.installation.suspended_at||payload.action==="suspend"?"suspended":"active";
      await db.from("github_installations").update({status,suspended_at:status==="suspended"?(payload.installation.suspended_at??now):null,permissions:payload.installation.permissions??{},events:payload.installation.events??[],updated_at:now}).eq("installation_id",installationId);
      if(status!=="active"&&installation?.data)await db.from("repositories").update({status:status==="deleted"?"disabled":"installation_suspended",updated_at:now}).eq("github_installation_id",installation.data.id);
    }
    if(eventType==="installation_repositories"&&installation?.data){
      const removed=(payload.repositories_removed??[]).map(item=>item.id);if(removed.length)await db.from("repositories").update({status:"disabled",updated_at:now}).eq("github_installation_id",installation.data.id).in("github_repository_id",removed);
      const added=(payload.repositories_added??[]).map(item=>item.id);if(added.length)await db.from("repositories").update({status:"active",updated_at:now}).eq("github_installation_id",installation.data.id).in("github_repository_id",added);
    }
    if(eventType==="pull_request"&&payload.action==="closed"&&payload.pull_request?.merged&&payload.pull_request.number){
      const legacyConnection=await db.from("repository_connections").select("id").eq("repository_owner",payload.repository?.owner?.login??"").eq("repository_name",payload.repository?.name??"").maybeSingle();
      if(legacyConnection.data){const execution=await db.from("seo_executions").select("id,agency_id,project_id").eq("repository_connection_id",legacyConnection.data.id).eq("pull_request_number",payload.pull_request.number).maybeSingle();if(execution.data){await db.from("seo_executions").update({status:"merged",merge_commit_sha:payload.pull_request.merge_commit_sha,merged_at:now}).eq("id",execution.data.id);logEvent("github_pr_merged",{executionId:execution.data.id,agencyId:execution.data.agency_id,projectId:execution.data.project_id,status:"merged"});}}
    }
    await db.from("webhook_events").update({status:"processed",processed_at:now}).eq("id",eventId);
    await db.from("webhook_deliveries").upsert({provider:"github",delivery_id:delivery,event_type:eventType,signature_valid:true,payload_hash:createHash("sha256").update(raw).digest("hex"),processed_at:now},{onConflict:"provider,delivery_id"});
    return Response.json({ok:true});
  }catch(error){await db.from("webhook_events").update({status:"failed",error_code:"PROCESSING_FAILED",error_message:error instanceof Error?error.message.slice(0,500):"Unknown webhook error"}).eq("id",eventId);return Response.json({ok:false,error:"processing_failed"},{status:500})}
}
