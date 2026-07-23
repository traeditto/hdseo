import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { safeError, logEvent } from "@/lib/api/errors";
import type { CampaignJob } from "./types";
import { discoverStage,validateStage,snapshotStage,scoreStage,selectStage,prepareStage } from "./stages/intelligence";
import { inspectStage,diffStage,validationStage,createPrStage,monitoringStage } from "./stages/execution";
import {wakeManagedAgentService} from "@/lib/agent-service/wake";

const handlers = { discover:discoverStage,validate:validateStage,snapshot:snapshotStage,score:scoreStage,select:selectStage,prepare:prepareStage,inspect_repository:inspectStage,generate_diff:diffStage,validate_changes:validationStage,create_pr:createPrStage,schedule_monitoring:monitoringStage };
export async function processOneCampaignJob(workerId=crypto.randomUUID()){
  const db=createSupabaseAdminClient();if(!db)throw new Error("Supabase is not configured.");
  const claimed=await db.rpc("claim_seo_campaign_job",{p_worker_id:workerId,p_lock_seconds:300}),job=(claimed.data??[])[0] as CampaignJob|undefined;if(!job)return{status:"idle"};
  const started=Date.now();logEvent("job_claimed",{jobId:job.id,agencyId:job.agency_id,projectId:job.project_id,stage:job.current_stage,referenceId:job.reference_id});
  try{
    const handler=handlers[job.current_stage];
    if(!handler)throw new Error(`Unknown stage: ${job.current_stage}`);
    const result=await handler(db,job);
    if(job.input.managedDiscoveryOnly===true&&result.status==="completed"){
      await wakeManagedAgentService(db,{agencyId:job.agency_id,clientId:job.client_organization_id,projectId:job.project_id,reason:"discovery_completed"});
    }
    logEvent("job_stage_completed",{jobId:job.id,stage:job.current_stage,status:result.status,durationMs:Date.now()-started,referenceId:job.reference_id});
    return{jobId:job.id,...result};
  }
  catch(error){
    const safe=safeError(error),repositoryDrift=job.input.managedOutcome===true&&job.current_stage==="create_pr"&&safe.body.error.code==="CONFLICT"&&safe.body.error.message.includes("repository changed after review")&&Number(job.input.repositoryDriftRecoveryAttempts??0)<1;
    if(repositoryDrift){
      const timestamp=new Date().toISOString();
      await db.from("seo_campaign_jobs").update({
        status:"queued",current_stage:"inspect_repository",
        input:{...job.input,repositoryDriftRecoveryAttempts:1},
        attempt_count:0,error_code:null,error_message:null,
        error_details:{automaticRecovery:"repository_drift",previousReferenceId:safe.body.error.referenceId},
        next_attempt_at:timestamp,failed_at:null,worker_id:null,locked_at:null,lock_expires_at:null,heartbeat_at:timestamp,updated_at:timestamp,
      }).eq("id",job.id);
      await wakeManagedAgentService(db,{agencyId:job.agency_id,clientId:job.client_organization_id,projectId:job.project_id,reason:"workflow_recovered"});
      logEvent("repository_drift_regeneration_queued",{jobId:job.id,stage:job.current_stage,status:"queued",errorCode:safe.body.error.code,referenceId:job.reference_id});
      return{jobId:job.id,status:"retry_scheduled",recovery:"repository_drift_regeneration"};
    }
    const waitingForEvidence=safe.body.error.code==="EVIDENCE_REFRESH_REQUIRED",nextAttempt=waitingForEvidence?job.attempt_count:job.attempt_count+1,retryable=!waitingForEvidence&&safe.status>=500&&nextAttempt<job.max_attempts,status=waitingForEvidence?"awaiting_evidence_refresh":retryable?"retry_scheduled":"failed";
    await db.from("seo_campaign_jobs").update({status,attempt_count:nextAttempt,error_code:safe.body.error.code,error_message:safe.body.error.message,error_details:{referenceId:safe.body.error.referenceId},next_attempt_at:new Date(Date.now()+Math.min(300_000,30_000*Math.max(1,nextAttempt))).toISOString(),failed_at:waitingForEvidence||retryable?null:new Date().toISOString(),worker_id:null,locked_at:null,lock_expires_at:null,heartbeat_at:new Date().toISOString()}).eq("id",job.id);
    logEvent(waitingForEvidence?"job_stage_waiting_for_evidence":"job_stage_failed",{jobId:job.id,stage:job.current_stage,status,errorCode:safe.body.error.code,referenceId:job.reference_id});
    return{jobId:job.id,status,error:safe.body.error};
  }
}
export async function processCampaignBatch(size:number){const results=[];for(let index=0;index<size;index++){const result=await processOneCampaignJob(`batch:${crypto.randomUUID()}`);results.push(result);if(result.status==="idle")break;}return results;}
