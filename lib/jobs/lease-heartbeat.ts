import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {ApiError} from "@/lib/api/errors";

export async function startLeaseHeartbeat(db:SupabaseClient,input:{jobId:string;workerId:string;fencingToken:string;lockSeconds?:number;intervalMs?:number}){
  let stopped=false,lost=false,inFlight:Promise<void>|null=null;
  const renew=async()=>{if(stopped||lost)return;const result=await db.rpc("extend_background_job_lease",{p_job_id:input.jobId,p_worker_id:input.workerId,p_fencing_token:input.fencingToken,p_lock_seconds:input.lockSeconds??300});if(result.error||!result.data)lost=true;};
  await renew();if(lost)throw new ApiError("The worker lost its job lease.",409,"CONFLICT");
  const timer=setInterval(()=>{if(!inFlight)inFlight=renew().finally(()=>{inFlight=null});},Math.max(10_000,input.intervalMs??60_000));
  timer.unref?.();
  return{
    async verify(){if(inFlight)await inFlight;if(lost)throw new ApiError("The worker lost its job lease.",409,"CONFLICT");},
    async stop(){stopped=true;clearInterval(timer);if(inFlight)await inFlight;},
    get lost(){return lost},
  };
}
