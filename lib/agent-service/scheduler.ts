import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";
import {ApiError} from "@/lib/api/errors";
import {enqueueAgentWorkItem} from "@/lib/agents/control-plane";
import {getLiveAdminClient} from "@/lib/live/identity";

type Enrollment={id:string;agency_id:string;client_organization_id:string;client_id:string;project_id:string;created_by:string|null;approval_owner:"agency"|"client"|"both";monthly_action_limit:number;actions_used:number;monthly_provider_budget:number;provider_spend_used:number;cycle_cadence_hours:number;status:string;risk_ceiling:"low"|"medium"|"high";allowed_tools:string[];external_spend_requires_approval:boolean};
const terminal=new Set(["succeeded","blocked","failed","cancelled","dead_letter"]),now=()=>new Date().toISOString();
const object=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;

async function release(db:SupabaseClient,enrollment:Enrollment,hours=enrollment.cycle_cadence_hours){
  await db.from("agent_service_enrollments").update({worker_id:null,locked_at:null,lock_expires_at:null,last_cycle_at:now(),next_cycle_at:new Date(Date.now()+hours*3600000).toISOString(),updated_at:now()}).eq("id",enrollment.id);
}
async function escalate(db:SupabaseClient,enrollment:Enrollment,cycleId:string|null,type:string,title:string,summary:string,requiresClient=false){
  await db.from("agent_service_escalations").insert({enrollment_id:enrollment.id,cycle_id:cycleId,agency_id:enrollment.agency_id,client_organization_id:enrollment.client_organization_id,project_id:enrollment.project_id,escalation_type:type,title,summary,risk_level:type==="billing"?"high":"medium",requires_client:requiresClient,metadata:{source:"agent_service_scheduler"}});
}

async function reconcileActiveCycle(db:SupabaseClient,enrollment:Enrollment){
  const cycle=await db.from("agent_service_cycles").select("*").eq("enrollment_id",enrollment.id).in("status",["queued","running","awaiting_approval","monitoring"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!cycle.data)return false;
  const ids=(cycle.data.work_item_ids??[]) as string[];
  const work=ids.length?await db.from("agent_work_items").select("id,status,final_outcome").in("id",ids):{data:[]};
  const items=work.data??[],awaiting=items.some(item=>item.status==="awaiting_approval"),done=items.length>0&&items.every(item=>terminal.has(item.status));
  if(!done){await db.from("agent_service_cycles").update({status:awaiting?"awaiting_approval":"running",stage:awaiting?"approval":"execution",updated_at:now()}).eq("id",cycle.data.id);await release(db,enrollment,awaiting?6:1);return true;}
  const failed=items.filter(item=>["failed","dead_letter","blocked"].includes(item.status));
  const cancelled=items.some(item=>item.status==="cancelled");
  if(failed.length||cancelled)await db.rpc("refund_agent_service_capacity",{p_enrollment_id:enrollment.id,p_original_idempotency_key:`cycle:${cycle.data.id}`,p_refund_idempotency_key:`cycle-refund:${cycle.data.id}`,p_reason:cancelled?"Managed cycle was cancelled before delivery":"Managed cycle failed before delivery"});
  await db.from("agent_service_cycles").update({status:failed.length?"failed":"succeeded",stage:"outcome",outcome_summary:{workItems:items.length,failed:failed.length},recommendation:failed.length?"IMPROVE":"KEEP",completed_at:now(),next_review_at:new Date(Date.now()+7*86400000).toISOString(),updated_at:now()}).eq("id",cycle.data.id);
  if(failed.length)await escalate(db,enrollment,cycle.data.id,"worker","Managed SEO work needs attention",`${failed.length} work item${failed.length===1?"":"s"} could not complete after bounded retries.`);
  await release(db,enrollment);return true;
}

async function beginCycle(db:SupabaseClient,enrollment:Enrollment){
  if(await reconcileActiveCycle(db,enrollment))return{enrollmentId:enrollment.id,status:"reconciled"};
  const subscription=await db.from("client_subscriptions").select("status").eq("project_id",enrollment.project_id).maybeSingle();
  if(subscription.data&&!["active","trialing"].includes(subscription.data.status)){
    await db.from("agent_service_enrollments").update({status:subscription.data.status==="past_due"?"past_due":"paused",pause_reason:"Billing is not active",worker_id:null,locked_at:null,lock_expires_at:null,updated_at:now()}).eq("id",enrollment.id);
    await escalate(db,enrollment,null,"billing","Managed SEO is paused","Billing must be active before the next agent cycle can run.",true);return{enrollmentId:enrollment.id,status:"billing_blocked"};
  }
  const opportunity=await db.from("seo_opportunities").select("id,opportunity_score,confidence_score,action_type,target_milestone,evidence,recommended_actions,status").eq("agency_id",enrollment.agency_id).eq("client_organization_id",enrollment.client_organization_id).eq("project_id",enrollment.project_id).in("status",["open","selected","approved"]).gte("opportunity_score",55).order("opportunity_score",{ascending:false}).order("confidence_score",{ascending:false}).limit(1).maybeSingle();
  const cycleKey=`${new Date().toISOString().slice(0,13)}:${opportunity.data?.id??"no-action"}`;
  const cycle=await db.from("agent_service_cycles").upsert({enrollment_id:enrollment.id,agency_id:enrollment.agency_id,client_organization_id:enrollment.client_organization_id,client_id:enrollment.client_id,project_id:enrollment.project_id,cycle_key:cycleKey,status:opportunity.data?"running":"no_action",stage:opportunity.data?"decision":"complete",selected_opportunity_id:opportunity.data?.id??null,evidence_summary:opportunity.data??{reason:"No evidence-backed opportunity met the minimum value and confidence threshold."},expected_value:number(object(opportunity.data?.evidence).estimated_monthly_value)||null,started_at:now(),completed_at:opportunity.data?null:now(),recommendation:opportunity.data?null:"NO_ACTION",updated_at:now()},{onConflict:"enrollment_id,cycle_key"}).select("*").single();
  if(cycle.error||!cycle.data)throw new ApiError("The managed-service cycle could not be created. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  if(!opportunity.data){await release(db,enrollment);return{enrollmentId:enrollment.id,cycleId:cycle.data.id,status:"no_action"};}
  const approvedPackage=await db.from("implementation_packages").select("id").eq("agency_id",enrollment.agency_id).eq("project_id",enrollment.project_id).eq("status","client_approved").order("created_at",{ascending:false}).limit(1).maybeSingle(),cmsConnection=approvedPackage.data?await db.from("cms_connections").select("id,cms_type").eq("agency_id",enrollment.agency_id).eq("project_id",enrollment.project_id).eq("status","active").in("cms_type",["wordpress","shopify","webflow"]).limit(1).maybeSingle():null,directImplementationReady=Boolean(approvedPackage.data&&cmsConnection?.data),workTypes=(opportunity.data.action_type==="MAPS"||opportunity.data.action_type==="LOCALIZE")?["research.discovery","strategy.roadmap","local.plan","reporting.summary"] as const:directImplementationReady?["research.discovery","strategy.roadmap","content.plan","implementation.change","qa.validate","reporting.summary"] as const:["research.discovery","strategy.roadmap","content.plan","reporting.summary"] as const;
  // This cycle consumes existing evidence. Paid provider usage is recorded by
  // the provider worker only when a real external request succeeds.
  const providerCost=0;
  const capacity=await db.rpc("consume_agent_service_capacity",{p_enrollment_id:enrollment.id,p_action_units:1,p_provider_cost:providerCost,p_idempotency_key:`cycle:${cycle.data.id}`,p_metadata:{cycleId:cycle.data.id,opportunityId:opportunity.data.id,definition:"one completed customer-visible deliverable"}});
  if(capacity.error)throw new ApiError("Managed-service capacity could not be reserved.",503,"DATABASE_BINDING_FAILED");
  if(!capacity.data?.allowed){const reason=String(capacity.data?.reason??"CAPACITY_EXCEEDED");await db.from("agent_service_cycles").update({status:"blocked",stage:"capacity",failure_code:reason,failure_message:"The monthly managed-service limit was reached.",completed_at:now(),updated_at:now()}).eq("id",cycle.data.id);await escalate(db,enrollment,cycle.data.id,reason.includes("BUDGET")?"budget":"capacity","Managed SEO capacity reached","The next evidence-backed action is ready, but this month's managed-service capacity has been used.",enrollment.approval_owner!=="agency");await release(db,enrollment,24);return{enrollmentId:enrollment.id,cycleId:cycle.data.id,status:"capacity_blocked"};}
  const sourceId=cycle.data.id as string,results=[];
  for(const [index,workType] of workTypes.entries()){
    const pathTools=workType==="implementation.change"?["cms.draft","cms.publish"]:workType==="qa.validate"?["lighthouse.run","seo.validate","schema.validate","sitemap.verify","robots.verify"]:null,allowedTools=pathTools?(enrollment.allowed_tools.length?pathTools.filter(tool=>enrollment.allowed_tools.includes(tool)):pathTools):enrollment.allowed_tools;
    results.push(await enqueueAgentWorkItem(db,{agencyId:enrollment.agency_id,clientId:enrollment.client_organization_id,projectId:enrollment.project_id,userId:enrollment.created_by},{workType,evidence:{cycleId:sourceId,opportunity:opportunity.data,implementationProvider:cmsConnection?.data?.cms_type??null},proposedPlan:{serviceMode:"managed_agent",approvalOwner:enrollment.approval_owner,noMakeWorkRule:true},spendingLimit:workType==="research.discovery"?providerCost:0,priority:95-index*10,idempotencyKey:`agent-service:${sourceId}:${workType}`,sourceType:"agent_service_cycle",sourceId,approvalOwner:enrollment.approval_owner,allowedTools,riskCeiling:enrollment.risk_ceiling,externalSpendRequiresApproval:enrollment.external_spend_requires_approval}));
  }
  const workIds=results.map(result=>result.workItemId);
  await db.from("agent_service_cycles").update({work_item_ids:workIds,stage:"execution",updated_at:now()}).eq("id",cycle.data.id);
  await release(db,enrollment,1);return{enrollmentId:enrollment.id,cycleId:cycle.data.id,status:"queued",workItems:workIds.length};
}

export async function processAgentServiceBatch(size=10,workerId=`agent-service:${crypto.randomUUID()}`){
  const db=getLiveAdminClient(),claimed=await db.rpc("claim_due_agent_service_enrollments",{p_worker_id:workerId,p_batch_size:size,p_lock_seconds:300});
  if(claimed.error)throw new ApiError("Managed agent enrollments could not be claimed. Apply migration 0026.",503,"DATABASE_BINDING_FAILED");
  const enrollments=(claimed.data??[]) as Enrollment[],results=[];
  for(const enrollment of enrollments){try{results.push(await beginCycle(db,enrollment));}catch(error){const message=error instanceof Error?error.message:"Managed cycle failed";await db.from("agent_service_enrollments").update({worker_id:null,locked_at:null,lock_expires_at:null,next_cycle_at:new Date(Date.now()+3600000).toISOString(),updated_at:now()}).eq("id",enrollment.id);await escalate(db,enrollment,null,"worker","Managed SEO cycle failed",message);results.push({enrollmentId:enrollment.id,status:"failed"});}}
  return{claimed:enrollments.length,results};
}
