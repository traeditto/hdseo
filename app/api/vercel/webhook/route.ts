import {createHash} from "node:crypto";

import {logEvent,safeError} from "@/lib/api/errors";
import {requireAdminDb} from "@/lib/automation/control-plane";
import {env} from "@/lib/config/env";
import {sanitizeWebhookPayload} from "@/lib/security/webhook-payload";
import {verifyWebhookSignature} from "@/lib/seo/webhook-signature";
import {claimWebhookEvent,completeWebhookEvent,failWebhookEvent,requireWebhookMutation} from "@/lib/webhooks/inbox";

type VercelPayload={type?:string;id?:string;payload?:{id?:string;url?:string;target?:string;configuration?:{id?:string};project?:{id?:string};deployment?:{id?:string;url?:string;target?:string;meta?:Record<string,string>;readyState?:string};meta?:Record<string,string>}};

export async function POST(request:Request){
  const raw=await request.text(),signature=request.headers.get("x-vercel-signature"),payloadHash=createHash("sha256").update(raw).digest("hex"),delivery=request.headers.get("x-vercel-id")??request.headers.get("x-vercel-delivery")??payloadHash;
  if(!env.VERCEL_WEBHOOK_SECRET||!verifyWebhookSignature(raw,signature,env.VERCEL_WEBHOOK_SECRET,"","sha1"))return Response.json({ok:false,error:"invalid_signature"},{status:401});
  let event:VercelPayload;
  try{event=JSON.parse(raw) as VercelPayload;}catch{return Response.json({ok:false,error:"invalid_json"},{status:400});}
  const payload=event.payload??{},providerDeployment=payload.deployment??{},meta=providerDeployment.meta??payload.meta??{},providerProjectId=payload.project?.id??meta.projectId,deploymentId=providerDeployment.id??payload.id,db=requireAdminDb();
  const configuration=payload.configuration?.id?await db.from("vercel_connections").select("id,agency_id").eq("configuration_id",payload.configuration.id).maybeSingle():null;
  const project=providerProjectId?await db.from("vercel_projects").select("id,agency_id,project_id").eq("vercel_project_id",providerProjectId).maybeSingle():null;
  const type=event.type??"unknown",sanitized=sanitizeWebhookPayload(event);
  let inbox:{eventId:string;duplicate:boolean;replayed:boolean};
  try{inbox=await claimWebhookEvent(db,{provider:"vercel",deliveryId:delivery,agencyId:project?.data?.agency_id??configuration?.data?.agency_id??null,eventType:type,payloadHash,payload:sanitized});}
  catch(error){const safe=safeError(error);return Response.json({ok:false,error:safe.body.error},{status:safe.status});}
  if(inbox.duplicate)return Response.json({ok:true,duplicate:true});
  const now=new Date().toISOString(),ready=["deployment.ready","deployment.succeeded","deployment.promoted"].includes(type),failed=["deployment.error","deployment.canceled"].includes(type),created=type==="deployment.created";
  try{
    if(type==="integration-configuration.removed"&&configuration?.data)requireWebhookMutation(await db.from("vercel_connections").update({status:"revoked",updated_at:now}).eq("id",configuration.data.id),"The Vercel connection revocation could not be recorded.");
    const deploymentSelect="id,agency_id,automation_run_id,project_id,git_sha,environment,provider_metadata";
    const managed=meta.hdSeoDeploymentId
      ?await db.from("deployments").select(deploymentSelect).eq("id",meta.hdSeoDeploymentId).maybeSingle()
      :deploymentId?await db.from("deployments").select(deploymentSelect).eq("external_deployment_id",deploymentId).maybeSingle():null;
    if(managed?.data){
      const status=ready?"ready":failed?(type==="deployment.canceled"?"cancelled":"failed"):created?"building":"building",previousMetadata=managed.data.provider_metadata&&typeof managed.data.provider_metadata==="object"&&!Array.isArray(managed.data.provider_metadata)?managed.data.provider_metadata:{};
      requireWebhookMutation(await db.from("deployments").update({external_deployment_id:deploymentId??undefined,url:providerDeployment.url??payload.url??undefined,status,ready_at:ready?now:null,completed_at:failed?now:null,updated_at:now,provider_metadata:{...previousMetadata,eventType:type,readyState:providerDeployment.readyState??null}}).eq("id",managed.data.id),"The managed deployment event could not be recorded.");
      if(ready)requireWebhookMutation(await db.from("background_jobs").upsert({queue:"deployments",job_type:"deployment.validate",agency_id:managed.data.agency_id,automation_run_id:managed.data.automation_run_id,deployment_id:managed.data.id,payload:{},status:"queued",priority:80,idempotency_key:`deployment.validate:${managed.data.id}`},{onConflict:"queue,idempotency_key",ignoreDuplicates:true}),"Deployment validation could not be queued.");
      if(failed&&managed.data.automation_run_id)requireWebhookMutation(await db.from("automation_runs").update({status:"failed",error_code:"VERCEL_DEPLOYMENT_FAILED",error_message:`Vercel event: ${type}`,completed_at:now,updated_at:now}).eq("id",managed.data.automation_run_id),"The failed deployment run could not be recorded.");
    }
    const commitSha=meta.githubCommitSha??meta.gitCommitSha;
    if(commitSha){
      const execution=await db.from("seo_executions").select("id,agency_id,project_id,merge_commit_sha").or(`merge_commit_sha.eq.${commitSha},production_commit_sha.eq.${commitSha}`).maybeSingle();
      if(execution.data){
        const environment=providerDeployment.target??payload.target??"preview",legacyStatus=ready?"ready":failed?"failed":"building";
        requireWebhookMutation(await db.from("seo_deployments").upsert({execution_id:execution.data.id,provider:"vercel",environment,commit_sha:commitSha,deployment_id:deploymentId,deployment_url:providerDeployment.url??payload.url,status:legacyStatus,started_at:now,completed_at:ready||failed?now:null},{onConflict:"provider,environment,commit_sha"}),"The SEO deployment event could not be recorded.");
        if(ready&&environment==="production"&&execution.data.merge_commit_sha===commitSha){
          requireWebhookMutation(await db.from("seo_executions").update({status:"production_deployed",production_commit_sha:commitSha,production_deployed_at:now}).eq("id",execution.data.id),"The production SEO execution could not be recorded.");
          requireWebhookMutation(await db.from("seo_campaign_jobs").update({status:"queued",current_stage:"schedule_monitoring",next_attempt_at:now}).contains("result",{executionId:execution.data.id}),"Production outcome monitoring could not be queued.");
          logEvent("production_deployed",{executionId:execution.data.id,agencyId:execution.data.agency_id,projectId:execution.data.project_id,status:"production_deployed"});
        }
      }
    }
    requireWebhookMutation(await db.from("webhook_deliveries").upsert({provider:"vercel",delivery_id:delivery,event_type:type,signature_valid:true,payload_hash:payloadHash,processed_at:now},{onConflict:"provider,delivery_id"}),"The Vercel delivery receipt could not be saved.");
    await completeWebhookEvent(db,{eventId:inbox.eventId,status:managed?.data||commitSha?"processed":"ignored"});
    return Response.json({ok:true,status:ready?"ready":failed?"failed":"accepted",replayed:inbox.replayed});
  }catch(error){const safe=safeError(error);await failWebhookEvent(db,{eventId:inbox.eventId,code:safe.body.error.code,message:safe.body.error.message});return Response.json({ok:false,error:safe.body.error},{status:safe.status});}
}
