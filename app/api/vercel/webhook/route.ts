import { createHash } from "node:crypto";
import { env } from "@/lib/config/env";
import { verifyWebhookSignature } from "@/lib/seo/webhook-signature";
import { requireAdminDb } from "@/lib/automation/control-plane";
import { sanitizeWebhookPayload } from "@/lib/security/webhook-payload";
import { logEvent } from "@/lib/api/errors";

type VercelPayload={type?:string;id?:string;payload?:{id?:string;url?:string;target?:string;configuration?:{id?:string};project?:{id?:string};deployment?:{id?:string;url?:string;target?:string;meta?:Record<string,string>;readyState?:string};meta?:Record<string,string>}};
export async function POST(request:Request){
  const raw=await request.text(),signature=request.headers.get("x-vercel-signature"),delivery=request.headers.get("x-vercel-id")??request.headers.get("x-vercel-delivery")??createHash("sha256").update(raw).digest("hex");
  if(!env.VERCEL_WEBHOOK_SECRET||!verifyWebhookSignature(raw,signature,env.VERCEL_WEBHOOK_SECRET,"","sha1"))return Response.json({ok:false,error:"invalid_signature"},{status:401});
  let event:VercelPayload;try{event=JSON.parse(raw) as VercelPayload}catch{return Response.json({ok:false,error:"invalid_json"},{status:400})}
  const payload=event.payload??{},providerDeployment=payload.deployment??{},meta=providerDeployment.meta??payload.meta??{},providerProjectId=payload.project?.id??meta.projectId,deploymentId=providerDeployment.id??payload.id,db=requireAdminDb(),configuration=payload.configuration?.id?await db.from("vercel_connections").select("id,agency_id").eq("configuration_id",payload.configuration.id).maybeSingle():null;
  const project=providerProjectId?await db.from("vercel_projects").select("id,agency_id,project_id").eq("vercel_project_id",providerProjectId).maybeSingle():null;
  const inserted=await db.from("webhook_events").insert({provider:"vercel",delivery_id:delivery,agency_id:project?.data?.agency_id??configuration?.data?.agency_id??null,event_type:event.type??"unknown",payload_hash:createHash("sha256").update(raw).digest("hex"),payload:sanitizeWebhookPayload(event),signature_valid:true,status:"processing",attempt_count:1}).select("id").single();
  if(inserted.error){if(inserted.error.code==="23505")return Response.json({ok:true,duplicate:true});return Response.json({ok:false,error:"event_store_failed"},{status:500})}
  const now=new Date().toISOString(),type=event.type??"unknown",ready=["deployment.ready","deployment.succeeded","deployment.promoted"].includes(type),failed=["deployment.error","deployment.canceled"].includes(type),created=["deployment.created"].includes(type);
  try{
    if(type==="integration-configuration.removed"&&configuration?.data)await db.from("vercel_connections").update({status:"revoked",updated_at:now}).eq("id",configuration.data.id);
    const deploymentSelect="id,automation_run_id,project_id,git_sha,environment";
    const managed=meta.hdSeoDeploymentId
      ? await db.from("deployments").select(deploymentSelect).eq("id",meta.hdSeoDeploymentId).maybeSingle()
      : deploymentId
        ? await db.from("deployments").select(deploymentSelect).eq("external_deployment_id",deploymentId).maybeSingle()
        : null;
    if(managed?.data){
      const status=ready?"ready":failed?(type==="deployment.canceled"?"cancelled":"failed"):created?"building":"building";
      await db.from("deployments").update({external_deployment_id:deploymentId??undefined,url:providerDeployment.url??payload.url??undefined,status,ready_at:ready?now:null,completed_at:failed?now:null,updated_at:now,provider_metadata:{eventType:type,readyState:providerDeployment.readyState??null}}).eq("id",managed.data.id);
      if(ready){await db.from("background_jobs").upsert({queue:"deployments",job_type:"deployment.validate",agency_id:project?.data?.agency_id,automation_run_id:managed.data.automation_run_id,deployment_id:managed.data.id,payload:{},status:"queued",priority:80,idempotency_key:`deployment.validate:${managed.data.id}`},{onConflict:"queue,idempotency_key",ignoreDuplicates:true});}
      if(failed&&managed.data.automation_run_id){await db.from("automation_runs").update({status:"failed",error_code:"VERCEL_DEPLOYMENT_FAILED",error_message:`Vercel event: ${type}`,completed_at:now,updated_at:now}).eq("id",managed.data.automation_run_id);}
    }
    const commitSha=meta.githubCommitSha??meta.gitCommitSha;
    if(commitSha){const execution=await db.from("seo_executions").select("id,agency_id,project_id,merge_commit_sha").or(`merge_commit_sha.eq.${commitSha},production_commit_sha.eq.${commitSha}`).maybeSingle();if(execution.data){const environment=providerDeployment.target??payload.target??"preview",legacyStatus=ready?"ready":failed?"failed":"building";await db.from("seo_deployments").upsert({execution_id:execution.data.id,provider:"vercel",environment,commit_sha:commitSha,deployment_id:deploymentId,deployment_url:providerDeployment.url??payload.url,status:legacyStatus,started_at:now,completed_at:ready||failed?now:null},{onConflict:"provider,environment,commit_sha"});if(ready&&environment==="production"&&execution.data.merge_commit_sha===commitSha){await db.from("seo_executions").update({status:"production_deployed",production_commit_sha:commitSha,production_deployed_at:now}).eq("id",execution.data.id);await db.from("seo_campaign_jobs").update({status:"queued",current_stage:"schedule_monitoring",next_attempt_at:now}).contains("result",{executionId:execution.data.id});logEvent("production_deployed",{executionId:execution.data.id,agencyId:execution.data.agency_id,projectId:execution.data.project_id,status:"production_deployed"});}}}
    await db.from("webhook_events").update({status:managed?.data||commitSha?"processed":"ignored",processed_at:now}).eq("id",inserted.data.id);
    await db.from("webhook_deliveries").upsert({provider:"vercel",delivery_id:delivery,event_type:type,signature_valid:true,payload_hash:createHash("sha256").update(raw).digest("hex"),processed_at:now},{onConflict:"provider,delivery_id"});
    return Response.json({ok:true,status:ready?"ready":failed?"failed":"accepted"});
  }catch(error){await db.from("webhook_events").update({status:"failed",error_code:"PROCESSING_FAILED",error_message:error instanceof Error?error.message.slice(0,500):"Unknown webhook error"}).eq("id",inserted.data.id);return Response.json({ok:false,error:"processing_failed"},{status:500})}
}
