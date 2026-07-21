import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError, logServerError } from "@/lib/api/errors";
import { agentRegistry,workTemplates,type AgentWorkType } from "@/lib/agents/registry";
import {actionDigest} from "@/lib/safety/action-digest";

type AgentTenant={agencyId:string;clientId:string;projectId:string;userId:string|null};
const protectedApprovalType=new Map([
  ["cms.publish","publishing"],["github.write","publishing"],["vercel.deploy","deployment"],["vercel.rollback","destructive"],
  ["dns.write","dns"],["pricing.change","pricing"],["legal.publish","legal"],
]);

function requiredApprovals(workType:AgentWorkType,tools:readonly string[],riskLevel:string,approvalOwner:"agency"|"client"|"both"="agency"){
  const approvals:Array<{type:string;reason:string}>=[];
  if(riskLevel==="high"||riskLevel==="critical"){
    if(approvalOwner==="both")approvals.push({type:"agency",reason:"High-risk managed work requires accountable agency approval."},{type:"client",reason:"The business owner must approve high-risk managed work."});
    else approvals.push({type:approvalOwner,reason:`High-risk work requires accountable ${approvalOwner} approval.`});
  }
  for(const type of new Set(tools.map(tool=>protectedApprovalType.get(tool)).filter((value):value is string=>Boolean(value))))approvals.push({type:workType.startsWith("qa.")&&type==="destructive"?"risk":type,reason:"Publishing, deployment, DNS, legal, pricing, and destructive tools require explicit approval."});
  return approvals;
}

export async function enqueueAgentWorkItem(db:SupabaseClient,tenant:AgentTenant,input:{
  workType:AgentWorkType;goal?:string;evidence?:Record<string,unknown>;proposedPlan?:Record<string,unknown>;
  spendingLimit?:number;priority?:number;idempotencyKey:string;sourceType?:string;sourceId?:string;approvalOwner?:"agency"|"client"|"both";
  allowedTools?:readonly string[];riskCeiling?:"low"|"medium"|"high";externalSpendRequiresApproval?:boolean;
}){
  const template=workTemplates[input.workType];
  const client=await db.from("clients").select("id,automation_config").eq("agency_id",tenant.agencyId).eq("organization_id",tenant.clientId).maybeSingle();
  if(!client.data)throw new ApiError("The enterprise client record is unavailable.",409,"DATABASE_BINDING_FAILED");
  const riskOrder=["low","medium","high","critical"],ceiling=input.riskCeiling??"high";if(riskOrder.indexOf(template.riskLevel)>riskOrder.indexOf(ceiling))throw new ApiError(`The ${input.workType} risk exceeds this enrollment's ${ceiling} ceiling.`,409,"CONFLICT");
  const allowlist=input.allowedTools??[],authorizedTools=allowlist.length?template.tools.filter(tool=>allowlist.includes(tool)):[...template.tools];if(!authorizedTools.length)throw new ApiError(`This enrollment does not authorize any tools required by ${input.workType}.`,403,"ROLE_FORBIDDEN");
  const approvals=requiredApprovals(input.workType,authorizedTools,template.riskLevel,input.approvalOwner);if(input.externalSpendRequiresApproval&&(input.spendingLimit??0)>0&&!approvals.some(item=>item.type==="spending"))approvals.push({type:"spending",reason:"External provider spending requires explicit approval for this enrollment."});
  const result=await db.rpc("enqueue_agent_work_item",{
    p_agency_id:tenant.agencyId,p_client_id:client.data.id,p_project_id:tenant.projectId,p_work_type:input.workType,
    p_goal:input.goal?.trim()||template.goal,p_agent_key:template.agentKey,p_evidence:input.evidence??{},p_proposed_plan:input.proposedPlan??{},
    p_authorized_tools:authorizedTools,p_spending_limit:Math.max(0,input.spendingLimit??0),p_risk_level:template.riskLevel,
    p_required_approvals:approvals,p_priority:input.priority??template.priority,p_idempotency_key:input.idempotencyKey,p_requested_by:tenant.userId,
    p_source_type:input.sourceType??null,p_source_id:input.sourceId??null,
  });
  if(result.error||!result.data){
    const databaseMessage=result.error?.message??"enqueue_agent_work_item returned no data";
    const referenceId=logServerError("agent_work_item_enqueue_failed",new Error(databaseMessage),{
      agencyId:tenant.agencyId,clientId:tenant.clientId,projectId:tenant.projectId,
      operation:input.workType,errorCode:result.error?.code??"EMPTY_RPC_RESULT",
    });
    const migrationMissing=result.error?.code==="PGRST202"||result.error?.code==="42883";
    throw new ApiError(
      migrationMissing
        ? "The agent workspace database update is not installed. Support has been notified."
        : "Your agent team could not be started. No additional charge was made; please retry or contact support with the reference number.",
      503,"DATABASE_BINDING_FAILED",referenceId,
    );
  }
  return result.data as {workItemId:string;backgroundJobId?:string;duplicate:boolean};
}

export async function seedOnboardingAgentTeam(db:SupabaseClient,tenant:AgentTenant,input:{
  evidenceJobIds:string[];discoveryJobId:string|null;monthlyBudget:number;targetMarket:string;launchKey:string;
}){
  const sharedEvidence={evidenceJobIds:input.evidenceJobIds,discoveryJobId:input.discoveryJobId,targetMarket:input.targetMarket,onboardingLaunch:input.launchKey};
  const specs:Array<{workType:AgentWorkType;spendingLimit:number;priority:number}>=[
    {workType:"onboarding.profile",spendingLimit:0,priority:100},
    {workType:"technical.audit",spendingLimit:0,priority:95},
    {workType:"research.discovery",spendingLimit:Math.min(25,Math.max(0,input.monthlyBudget*.02)),priority:90},
    {workType:"strategy.roadmap",spendingLimit:0,priority:80},
    {workType:"reporting.summary",spendingLimit:0,priority:45},
  ];
  return Promise.all(specs.map(spec=>enqueueAgentWorkItem(db,tenant,{...spec,evidence:sharedEvidence,idempotencyKey:`onboarding:${input.launchKey}:${spec.workType}`,sourceType:"client_onboarding",sourceId:input.launchKey})));
}

export async function resumeEvidenceBlockedAgentWork(db:SupabaseClient,input:{agencyId:string;projectId:string;recoveryKey:string;allowedTools?:readonly string[]}){
  const blocked=await db.from("agent_work_items")
    .select("id,priority,work_type,status,authorized_tools,execution_context,final_outcome")
    .eq("agency_id",input.agencyId)
    .eq("project_id",input.projectId)
    .in("work_type",["research.discovery","strategy.roadmap"])
    .in("status",["blocked","failed"]);
  if(blocked.error)throw new ApiError("Evidence-ready agent work could not be inspected.",500,"DATABASE_BINDING_FAILED");
  let resumed=0;
  for(const work of blocked.data??[]){
    const code=String(asObject(work.final_outcome).code??""),template=workTemplates[work.work_type as AgentWorkType];
    const authorized:string[]=input.allowedTools
      ?input.allowedTools.length?template.tools.filter((tool:string)=>input.allowedTools!.includes(tool)):[...template.tools]
      :(work.authorized_tools??[]);
    const recoveredAuthorization=code==="ROLE_FORBIDDEN"&&authorized.some((tool:string)=>!(work.authorized_tools??[]).includes(tool));
    if(code!=="EVIDENCE_NOT_READY"&&!recoveredAuthorization)continue;
    if(!authorized.length)continue;
    const queued=await db.from("background_jobs").upsert({queue:"agents",job_type:"agent.supervise",agency_id:input.agencyId,payload:{workItemId:work.id},status:"queued",priority:work.priority,available_at:new Date().toISOString(),attempt_count:0,worker_id:null,locked_at:null,lock_expires_at:null,last_error_code:null,last_error_message:null,completed_at:null,idempotency_key:`agent.evidence-recovered:${work.id}:${input.recoveryKey}`,updated_at:new Date().toISOString()},{onConflict:"queue,idempotency_key"});
    if(queued.error)throw new ApiError("Evidence-ready agent work could not be requeued.",500,"DATABASE_BINDING_FAILED");
    const executionContext=asObject(work.execution_context),updated=await db.from("agent_work_items").update({status:"queued",authorized_tools:authorized,execution_context:{...executionContext,supervisorAttempts:0,waitingReason:null,waitingSince:null,evidenceRecoveredAt:new Date().toISOString()},final_outcome:{},failed_at:null,updated_at:new Date().toISOString()}).eq("id",work.id).in("status",["blocked","failed"]).select("id").maybeSingle();
    if(updated.error)throw new ApiError("Evidence-ready agent work could not be resumed.",500,"DATABASE_BINDING_FAILED");
    if(!updated.data)continue;
    resumed++;
  }
  return resumed;
}

const asObject=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const numberValue=(value:unknown)=>typeof value==="number"?value:Number(value)||0;

export async function agentWorkspaceSnapshot(db:SupabaseClient,tenant:Omit<AgentTenant,"userId">){
  const client=await db.from("clients").select("id,automation_config").eq("agency_id",tenant.agencyId).eq("organization_id",tenant.clientId).maybeSingle();
  if(!client.data)throw new ApiError("Client agent workspace not found.",404,"NOT_FOUND");
  const since=new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString();
  const [workRes,approvalsRes,mutationRes,activityRes,deploymentsRes,usageRes,toolSpendRes,opportunitiesRes,memoryRes]=await Promise.all([
    db.from("agent_work_items").select("id,work_type,goal,assigned_agent_key,supervisor_agent_key,status,priority,risk_level,evidence,proposed_plan,authorized_tools,spending_limit,spent_amount,required_approvals,execution_context,validation_results,final_outcome,source_type,source_id,started_at,completed_at,failed_at,created_at,updated_at").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).order("created_at",{ascending:false}).limit(100),
    db.from("agent_approvals").select("id,work_item_id,step_id,approval_type,title,summary,risk_level,requested_decision,status,requested_by_agent_key,requested_at,expires_at,decided_at,decision_note").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).order("requested_at",{ascending:false}).limit(100),
    db.from("mutation_intents").select("id,tool_key,resource_type,resource_id,environment,summary,risk_level,action_digest,status,requested_by,expires_at,created_at").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).order("created_at",{ascending:false}).limit(100),
    db.from("agent_activity_events").select("id,work_item_id,step_id,agent_key,event_type,title,description,metadata,occurred_at").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).order("occurred_at",{ascending:false}).limit(150),
    db.from("deployments").select("id,environment,git_ref,git_sha,url,status,validation_summary,created_at,completed_at,rollback_of_id").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).order("created_at",{ascending:false}).limit(20),
    db.from("data_usage_events").select("estimated_cost,actual_cost,status,created_at").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).gte("created_at",since),
    db.from("agent_tool_executions").select("cost_amount,status,created_at").eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId).gte("created_at",since),
    db.from("seo_opportunities").select("opportunity_score,evidence,status").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).in("status",["open","selected","approved"]),
    db.from("agent_memory").select("agent_key,memory_type",{count:"exact"}).eq("agency_id",tenant.agencyId).eq("client_id",client.data.id).eq("project_id",tenant.projectId),
  ]);
  if(workRes.error)throw new ApiError("The Agent Workspace database is not ready. Apply migration 0017.",503,"DATABASE_BINDING_FAILED");
  if(mutationRes.error)throw new ApiError("Protected actions are not ready. Apply migration 0030.",503,"DATABASE_BINDING_FAILED");
  const workItems=workRes.data??[],workIds=workItems.map(item=>item.id);
  const steps=workIds.length?(await db.from("agent_work_steps").select("id,work_item_id,sequence,agent_key,step_type,title,status,tool_key,input,output,evidence_refs,validation,error_code,error_message,started_at,completed_at,created_at,updated_at").in("work_item_id",workIds).order("sequence")).data??[]:[];
  const usage=(usageRes.data??[]).reduce((sum,row)=>sum+numberValue(row.actual_cost??row.estimated_cost),0);
  const agentSpend=(toolSpendRes.data??[]).reduce((sum,row)=>sum+numberValue(row.cost_amount),0);
  const expectedValue=(opportunitiesRes.data??[]).reduce((sum,row)=>sum+numberValue(asObject(row.evidence).estimated_monthly_value),0);
  const counts={queued:0,running:0,awaitingApproval:0,completed:0,blocked:0,failed:0};
  for(const item of workItems){if(item.status==="queued"||item.status==="planning"||item.status==="waiting_for_tools")counts.queued++;else if(item.status==="running"||item.status==="validating")counts.running++;else if(item.status==="awaiting_approval")counts.awaitingApproval++;else if(item.status==="succeeded")counts.completed++;else if(item.status==="blocked"||item.status==="dead_letter")counts.blocked++;else if(item.status==="failed")counts.failed++;}
  counts.awaitingApproval+=(mutationRes.data??[]).filter(item=>item.status==="awaiting").length;
  const automation=asObject(client.data.automation_config);
  return{
    agents:agentRegistry,workItems,steps,approvals:approvalsRes.data??[],mutationIntents:mutationRes.data??[],activity:activityRes.data??[],deployments:deploymentsRes.data??[],
    summary:{...counts,moneyUsed:Number((usage+agentSpend).toFixed(2)),monthlyBudget:numberValue(automation.monthlyBudget),expectedMonthlyValue:Number(expectedValue.toFixed(2)),memoryCount:memoryRes.count??0},
  };
}

async function enqueueSupervisorRetry(db:SupabaseClient,input:{agencyId:string;workItemId:string;priority:number;key:string}){
  const result=await db.from("background_jobs").upsert({queue:"agents",job_type:"agent.supervise",agency_id:input.agencyId,payload:{workItemId:input.workItemId},status:"queued",priority:input.priority,available_at:new Date().toISOString(),idempotency_key:input.key,updated_at:new Date().toISOString()},{onConflict:"queue,idempotency_key"});
  if(result.error)throw new ApiError("The supervisor could not resume this work item.",500,"DATABASE_BINDING_FAILED");
}

export async function decideAgentApproval(db:SupabaseClient,tenant:AgentTenant,input:{approvalId:string;decision:"approved"|"rejected";note?:string}){
  if(!tenant.userId)throw new ApiError("Sign in before deciding protected agent work.",401,"AUTH_REQUIRED");
  const client=await db.from("clients").select("id").eq("organization_id",tenant.clientId).eq("agency_id",tenant.agencyId).maybeSingle();
  if(client.error||!client.data)throw new ApiError("Client agent workspace not found.",404,"NOT_FOUND");
  const approval=await db.from("agent_approvals").select("id,work_item_id,status,title,approval_type,requested_decision,action_digest,expires_at").eq("id",input.approvalId).eq("agency_id",tenant.agencyId).eq("project_id",tenant.projectId).eq("client_id",client.data.id).maybeSingle();
  if(!approval.data)throw new ApiError("Agent approval not found.",404,"NOT_FOUND");
  if(approval.data.status!=="awaiting")throw new ApiError("This decision has already been recorded.",409,"CONFLICT");
  if(approval.data.expires_at&&new Date(approval.data.expires_at).getTime()<=Date.now()){await db.from("agent_approvals").update({status:"expired",decided_at:new Date().toISOString()}).eq("id",approval.data.id).eq("status","awaiting");throw new ApiError("This approval expired. The supervisor must request it again.",409,"APPROVAL_REQUIRED");}
  if(!approval.data.action_digest||actionDigest(approval.data.requested_decision)!==approval.data.action_digest)throw new ApiError("The protected action changed or predates exact-action approvals. Request a new approval.",409,"INVALID_STATE");
  const [agencyMember,clientMember]=await Promise.all([db.from("agency_members").select("role").eq("agency_id",tenant.agencyId).eq("user_id",tenant.userId).eq("status","active").maybeSingle(),db.from("client_members").select("role").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("user_id",tenant.userId).eq("status","active").maybeSingle()]);
  const agencyDecision=["agency_owner","agency_admin","seo_director"].includes(String(agencyMember.data?.role)),clientDecision=["client_admin","client_approver"].includes(String(clientMember.data?.role));
  if(approval.data.approval_type==="client"&&!clientDecision)throw new ApiError("This decision belongs to an authorized client approver.",403,"ROLE_FORBIDDEN");
  if(approval.data.approval_type!=="client"&&!agencyDecision)throw new ApiError("This decision requires an accountable agency approver.",403,"ROLE_FORBIDDEN");
  const now=new Date().toISOString();
  const updated=await db.from("agent_approvals").update({status:input.decision,decided_by:tenant.userId,decision_note:input.note??null,decided_at:now,approved_action:approval.data.requested_decision}).eq("id",approval.data.id).eq("status","awaiting");
  if(updated.error)throw new ApiError("The approval decision could not be saved.",500,"DATABASE_BINDING_FAILED");
  if(input.decision==="rejected")await db.from("agent_work_items").update({status:"blocked",final_outcome:{reason:"Approval rejected",approvalId:approval.data.id},updated_at:now}).eq("id",approval.data.work_item_id);
  else{
    const pending=await db.from("agent_approvals").select("id",{head:true,count:"exact"}).eq("work_item_id",approval.data.work_item_id).eq("status","awaiting");
    if(!pending.count){const work=await db.from("agent_work_items").update({status:"queued",approved_by:tenant.userId,updated_at:now}).eq("id",approval.data.work_item_id).select("priority").single();await enqueueSupervisorRetry(db,{agencyId:tenant.agencyId,workItemId:approval.data.work_item_id,priority:work.data?.priority??80,key:`agent.approval:${approval.data.id}`});}
  }
  await db.from("agent_activity_events").insert({agency_id:tenant.agencyId,client_id:client.data.id,project_id:tenant.projectId,work_item_id:approval.data.work_item_id,agent_key:"supervisor",event_type:`approval.${input.decision}`,title:`${approval.data.title} ${input.decision}`,description:input.note??"Decision recorded."});
}

export async function controlAgentWorkItem(db:SupabaseClient,tenant:AgentTenant,input:{workItemId:string;command:"cancel"|"retry"}){
  const client=await db.from("clients").select("id").eq("organization_id",tenant.clientId).eq("agency_id",tenant.agencyId).single();
  const work=await db.from("agent_work_items").select("id,status,priority").eq("id",input.workItemId).eq("agency_id",tenant.agencyId).eq("client_id",client.data?.id).eq("project_id",tenant.projectId).maybeSingle();
  if(!work.data)throw new ApiError("Agent work item not found.",404,"NOT_FOUND");
  const now=new Date().toISOString();
  if(input.command==="cancel"){
    if(["succeeded","cancelled"].includes(work.data.status))throw new ApiError("This work item can no longer be cancelled.",409,"CONFLICT");
    await Promise.all([db.from("agent_work_items").update({status:"cancelled",completed_at:now,updated_at:now}).eq("id",work.data.id),db.from("background_jobs").update({status:"cancelled",updated_at:now}).eq("queue","agents").contains("payload",{workItemId:work.data.id}).in("status",["queued","retry_scheduled"])]);
  }else{
    if(!["failed","blocked","dead_letter"].includes(work.data.status))throw new ApiError("Only failed or blocked work can be retried.",409,"CONFLICT");
    await db.from("agent_work_items").update({status:"queued",failed_at:null,final_outcome:{},updated_at:now}).eq("id",work.data.id);
    await enqueueSupervisorRetry(db,{agencyId:tenant.agencyId,workItemId:work.data.id,priority:work.data.priority,key:`agent.manual-retry:${work.data.id}:${crypto.randomUUID()}`});
  }
  await db.from("agent_activity_events").insert({agency_id:tenant.agencyId,client_id:client.data?.id,project_id:tenant.projectId,work_item_id:work.data.id,agent_key:"supervisor",event_type:`work_item.${input.command}`,title:`Work item ${input.command} requested`,metadata:{actorUserId:tenant.userId}});
}
