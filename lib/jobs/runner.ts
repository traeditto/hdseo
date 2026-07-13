import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { safeError, logEvent } from "@/lib/api/errors";
import type { CampaignJob } from "./types";
import { validateStage,snapshotStage,scoreStage,selectStage,prepareStage } from "./stages/intelligence";
import { inspectStage,diffStage,validationStage,createPrStage,monitoringStage } from "./stages/execution";

const handlers = { validate:validateStage,snapshot:snapshotStage,score:scoreStage,select:selectStage,prepare:prepareStage,inspect_repository:inspectStage,generate_diff:diffStage,validate_changes:validationStage,create_pr:createPrStage,schedule_monitoring:monitoringStage };
export async function processOneCampaignJob(workerId=crypto.randomUUID()){
  const db=createSupabaseAdminClient();if(!db)throw new Error("Supabase is not configured.");
  const claimed=await db.rpc("claim_seo_campaign_job",{p_worker_id:workerId,p_lock_seconds:300}),job=(claimed.data??[])[0] as CampaignJob|undefined;if(!job)return{status:"idle"};
  const started=Date.now();logEvent("job_claimed",{jobId:job.id,agencyId:job.agency_id,projectId:job.project_id,stage:job.current_stage,referenceId:job.reference_id});
  try{const handler=handlers[job.current_stage];if(!handler)throw new Error(`Unknown stage: ${job.current_stage}`);const result=await handler(db,job);logEvent("job_stage_completed",{jobId:job.id,stage:job.current_stage,status:result.status,durationMs:Date.now()-started,referenceId:job.reference_id});return{jobId:job.id,...result};}
  catch(error){const safe=safeError(error),retryable=safe.status>=500&&job.attempt_count<job.max_attempts;await db.from("seo_campaign_jobs").update({status:retryable?"retry_scheduled":"failed",error_code:safe.body.error.code,error_message:safe.body.error.message,error_details:{referenceId:safe.body.error.referenceId},next_attempt_at:new Date(Date.now()+Math.min(300_000,30_000*Math.max(1,job.attempt_count))).toISOString(),failed_at:retryable?null:new Date().toISOString(),worker_id:null,locked_at:null,lock_expires_at:null,heartbeat_at:new Date().toISOString()}).eq("id",job.id);logEvent("job_stage_failed",{jobId:job.id,stage:job.current_stage,status:retryable?"retry_scheduled":"failed",errorCode:safe.body.error.code,referenceId:job.reference_id});return{jobId:job.id,status:retryable?"retry_scheduled":"failed",error:safe.body.error};}
}
export async function processCampaignBatch(size:number){const results=[];for(let index=0;index<size;index++){const result=await processOneCampaignJob(`batch:${crypto.randomUUID()}`);results.push(result);if(result.status==="idle")break;}return results;}
