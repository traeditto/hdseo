import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decideCheckpoint, cooldownDays } from "@/lib/seo/monitoring";
import { collectOutcomeEvidence, scaleOutcomeBaseline, type OutcomeTotals } from "@/lib/seo/outcome-evidence";
import { recommendOutcomeAction } from "@/lib/seo/outcome-recommendation";
import { logServerError } from "@/lib/api/errors";

export async function processOneMonitoringCheckpoint(workerId=crypto.randomUUID()){
  const db=createSupabaseAdminClient();
  if(!db)throw new Error("Supabase is not configured.");
  const claim=await db.rpc("claim_seo_monitoring_checkpoint",{p_worker_id:workerId,p_lock_seconds:300}),checkpoint=(claim.data??[])[0];
  if(!checkpoint)return{status:"idle"};
  try{
    const planResult=await db.from("seo_monitoring_plans").select("*,seo_executions(action_type,agency_id,client_organization_id),seo_opportunities(target_milestone)").eq("id",checkpoint.monitoring_plan_id).single(),plan=planResult.data;
    if(!plan)throw new Error("Monitoring plan missing");
    const freshSince=new Date(Date.now()-3*86_400_000).toISOString(),ranking=plan.keyword_id?await db.from("organic_ranking_snapshots").select("position,ranking_url,collected_at").eq("project_id",plan.project_id).eq("keyword_id",plan.keyword_id).gte("collected_at",freshSince).order("collected_at",{ascending:false}).limit(1).maybeSingle():{data:null},decision=decideCheckpoint({checkpointDay:checkpoint.checkpoint_day,baseline:plan.baseline_position,position:ranking.data?.position==null?null:Number(ranking.data.position),rankingUrl:ranking.data?.ranking_url??null,targetUrl:plan.target_url,targetMilestone:plan.target_milestone,fresh:Boolean(ranking.data)}),execution=Array.isArray(plan.seo_executions)?plan.seo_executions[0]:plan.seo_executions,implementationStart=new Date(`${plan.implementation_date}T00:00:00Z`),observed=await collectOutcomeEvidence(db,{agencyId:plan.agency_id,clientId:plan.client_organization_id,projectId:plan.project_id},{targetUrl:plan.target_url,executionId:plan.execution_id,from:implementationStart,to:new Date()}),baselineEvidence=plan.baseline_outcomes&&typeof plan.baseline_outcomes==="object"?plan.baseline_outcomes:{days:28,selected:{}},scaledBaseline=scaleOutcomeBaseline(baselineEvidence as {days:number;selected:OutcomeTotals},checkpoint.checkpoint_day),recommendation=recommendOutcomeAction({checkpointDay:checkpoint.checkpoint_day,rankDecision:decision,baseline:scaledBaseline,observed:observed.selected}),terminal=decision==="MILESTONE_REACHED"||checkpoint.checkpoint_day===90;
    await db.from("seo_monitoring_checkpoints").update({status:decision==="MILESTONE_REACHED"?"milestone_reached":decision==="INCONCLUSIVE"?"inconclusive":"recorded",decision,position:ranking.data?.position??null,ranking_url:ranking.data?.ranking_url??null,collected_at:new Date().toISOString(),recommendation:recommendation.recommendation,evidence:{source:"stored_ranking_snapshot",capturedAt:ranking.data?.collected_at??null,disclaimer:"Ranking and outcome movement are observed after implementation; causation is not claimed."},outcome_evidence:{baseline:scaledBaseline,observed,comparison:recommendation.comparison,reason:recommendation.reason},worker_id:null,locked_at:null,lock_expires_at:null}).eq("id",checkpoint.id);
    await Promise.all([
      db.from("seo_monitoring_plans").update({latest_outcomes:observed,recommendation:recommendation.recommendation,recommendation_reason:recommendation.reason,status:terminal?(decision==="INCONCLUSIVE"?"inconclusive":"completed"):"scheduled",updated_at:new Date().toISOString()}).eq("id",plan.id),
      db.from("seo_executions").update({outcome_recommendation:recommendation.recommendation,outcome_summary:{checkpointDay:checkpoint.checkpoint_day,rankDecision:decision,baseline:scaledBaseline,observed,comparison:recommendation.comparison,reason:recommendation.reason},...(terminal?{status:"completed"}:{})}).eq("id",plan.execution_id),
    ]);
    if(terminal)await db.from("seo_opportunities").update({status:decision==="MILESTONE_REACHED"?"completed":"open",cooldown_until:new Date(Date.now()+cooldownDays(execution?.action_type??"LINK")*86_400_000).toISOString()}).eq("id",plan.opportunity_id);
    await db.from("notifications").insert({agency_id:plan.agency_id,client_organization_id:plan.client_organization_id,project_id:plan.project_id,event_type:"seo.outcome_recommendation",title:recommendation.recommendation==="KEEP"?"Keep this SEO change":recommendation.recommendation==="IMPROVE"?"Improve this SEO change":recommendation.recommendation==="ROLLBACK_RECOMMENDED"?"Review this change for rollback":"SEO monitoring continues",body:recommendation.reason,client_visible:true,status:"sent",sent_at:new Date().toISOString(),metadata:{executionId:plan.execution_id,monitoringPlanId:plan.id,checkpointDay:checkpoint.checkpoint_day,recommendation:recommendation.recommendation}});
    return{status:"recorded",checkpointId:checkpoint.id,decision,recommendation:recommendation.recommendation,terminal};
  }catch(error){
    const referenceId=logServerError("monitoring_checkpoint_failed",error,{operation:"monitoring_checkpoint",checkpointId:checkpoint.id});
    await db.from("seo_monitoring_checkpoints").update({status:"failed",worker_id:null,locked_at:null,lock_expires_at:null,error_details:{retryable:true,referenceId}}).eq("id",checkpoint.id);
    return{status:"failed",checkpointId:checkpoint.id,referenceId};
  }
}
