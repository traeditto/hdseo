import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError,safeError } from "@/lib/api/errors";
import { requireAdminDb } from "@/lib/automation/control-plane";
import { enqueueEvidenceJob } from "@/lib/evidence/queue";
import {createCreativeSpec} from "@/lib/creatives/service";
import{buildInternalLinkGraph,createCaseStudySnapshot,evaluateContentRefreshes,generateGrowthPlan}from"@/lib/growth/service";
import {actionDigest} from "@/lib/safety/action-digest";
import {publishCmsPackage} from "@/lib/websites/publishing";
import {verifyLiveImplementation} from "@/lib/manual/live-verification";
import {startLeaseHeartbeat} from "@/lib/jobs/lease-heartbeat";

type BackgroundJob={id:string;agency_id:string;payload:Record<string,unknown>;attempt_count:number;max_attempts:number;fencing_token:string|null};
type WorkItem={id:string;agency_id:string;client_id:string;project_id:string;work_type:string;goal:string;assigned_agent_key:string;status:string;priority:number;risk_level:string;evidence:Record<string,unknown>;proposed_plan:Record<string,unknown>;authorized_tools:string[];spending_limit:number;spent_amount:number;required_approvals:Array<{type?:string;reason?:string}>;execution_context:Record<string,unknown>;source_type:string|null;source_id:string|null;requested_by:string|null};

const now=()=>new Date().toISOString();
const asObject=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const asArray=(value:unknown)=>Array.isArray(value)?value:[];
const num=(value:unknown)=>typeof value==="number"?value:Number(value)||0;

async function event(db:SupabaseClient,work:WorkItem,eventType:string,title:string,description?:string,metadata:Record<string,unknown>={}){
  await db.from("agent_activity_events").insert({agency_id:work.agency_id,client_id:work.client_id,project_id:work.project_id,work_item_id:work.id,agent_key:work.assigned_agent_key,event_type:eventType,title,description:description??null,metadata});
}

async function memory(db:SupabaseClient,work:WorkItem,key:string,type:string,content:Record<string,unknown>,evidenceRefs:unknown[]=[]){
  await db.from("agent_memory").upsert({agency_id:work.agency_id,client_id:work.client_id,project_id:work.project_id,agent_key:work.assigned_agent_key,memory_scope:"project",memory_key:key,memory_type:type,content,evidence_refs:evidenceRefs,confidence:1,sensitivity:"internal",source_work_item_id:work.id,updated_at:now()},{onConflict:"agency_id,client_id,project_id,agent_key,memory_scope,memory_key"});
}

async function beginToolExecution(db:SupabaseClient,work:WorkItem,toolKey:string,cost=0){
  if(!work.authorized_tools.includes(toolKey))throw new ApiError(`The ${work.assigned_agent_key} agent is not authorized to use ${toolKey}.`,403,"ROLE_FORBIDDEN");
  const idempotencyKey=`${toolKey}:${work.id}`,existing=await db.from("agent_tool_executions").select("id,status").eq("work_item_id",work.id).eq("idempotency_key",idempotencyKey).maybeSingle();if(existing.data?.status==="succeeded")return{id:existing.data.id,alreadySucceeded:true};
  const authorized=await db.rpc("authorize_agent_tool_execution",{p_work_item_id:work.id,p_tool_key:toolKey,p_cost:Math.max(0,cost)});if(authorized.error||!authorized.data?.authorized)throw new ApiError(`The ${toolKey} authorization changed before execution.`,403,"ROLE_FORBIDDEN");
  if(existing.data){const resumed=await db.from("agent_tool_executions").update({status:"running",risk_level:authorized.data.riskLevel??"low",request_payload:{goal:work.goal},response_summary:{},error_code:null,error_message:null,started_at:now(),completed_at:null}).eq("id",existing.data.id).neq("status","succeeded").select("id").maybeSingle();if(resumed.error||!resumed.data)throw new ApiError("The prior agent tool attempt could not be resumed safely.",409,"CONFLICT");return{id:resumed.data.id,alreadySucceeded:false};}
  const result=await db.from("agent_tool_executions").insert({agency_id:work.agency_id,client_id:work.client_id,project_id:work.project_id,work_item_id:work.id,agent_key:work.assigned_agent_key,tool_key:toolKey,status:"running",risk_level:authorized.data.riskLevel??"low",request_payload:{goal:work.goal},response_summary:{},cost_amount:cost,idempotency_key:idempotencyKey,started_at:now()}).select("id").single();
  if(result.error||!result.data)throw new ApiError("The agent tool execution could not be audited.",500,"DATABASE_BINDING_FAILED");return{id:result.data.id,alreadySucceeded:false};
}
async function completeToolExecution(db:SupabaseClient,executionId:string,status:"succeeded"|"failed"|"denied",summary:Record<string,unknown>){const result=await db.from("agent_tool_executions").update({status,response_summary:summary,error_code:status==="failed"?String(summary.code??"TOOL_EXECUTION_FAILED"):null,error_message:status==="failed"?String(summary.message??"Tool execution failed.").slice(0,500):null,completed_at:now()}).eq("id",executionId).eq("status","running").select("id").maybeSingle();if(result.error||!result.data)throw new ApiError("The agent tool result could not be audited.",500,"DATABASE_BINDING_FAILED");}
async function toolExecution(db:SupabaseClient,work:WorkItem,toolKey:string,status:"succeeded"|"failed"|"denied",summary:Record<string,unknown>,cost=0){
  const execution=await beginToolExecution(db,work,toolKey,cost);if(execution.alreadySucceeded)return;await completeToolExecution(db,execution.id,status,summary);
}

const stepPlans:Record<string,Array<{agentKey?:string;stepType:string;title:string;toolKey?:string}>>={
  "onboarding.profile":[{stepType:"evidence.collect",title:"Read business and integration profile",toolKey:"website.detect"},{stepType:"memory.write",title:"Save the verified project profile"},{agentKey:"qa",stepType:"validate",title:"Validate onboarding completeness"}],
  "research.discovery":[{stepType:"evidence.collect",title:"Read ranking and keyword evidence",toolKey:"google.search_console.read"},{stepType:"analyze",title:"Score keyword and competitor opportunities",toolKey:"opportunities.score"},{agentKey:"qa",stepType:"validate",title:"Validate evidence and budget attribution"}],
  "strategy.roadmap":[{stepType:"evidence.collect",title:"Read approved opportunities",toolKey:"audit.read"},{stepType:"plan",title:"Build the value-gated Local Growth Plan",toolKey:"growth.plan"},{agentKey:"qa",stepType:"validate",title:"Validate dependencies, service areas, approvals, and expected value"}],
  "technical.audit":[{stepType:"evidence.collect",title:"Collect crawl and indexing evidence",toolKey:"website.crawl"},{stepType:"analyze",title:"Analyze indexability, metadata, schema, links, and performance",toolKey:"seo.validate"},{stepType:"analyze",title:"Build the internal-link graph",toolKey:"internal_links.graph"},{agentKey:"qa",stepType:"validate",title:"Validate technical findings",toolKey:"robots.verify"}],
  "content.plan":[{stepType:"evidence.collect",title:"Read search, page, and verified business proof",toolKey:"proof.read"},{stepType:"analyze",title:"Find evidence-backed refresh wins",toolKey:"content.refresh"},{stepType:"draft",title:"Compile intent-specific creative specifications",toolKey:"creative.spec"},{agentKey:"qa",stepType:"validate",title:"Validate claims, originality requirements, and target intent"}],
  "local.plan":[{stepType:"evidence.collect",title:"Read service-area and local evidence"},{stepType:"plan",title:"Prepare local visibility plan",toolKey:"strategy.plan"},{agentKey:"qa",stepType:"validate",title:"Validate location and claim evidence"}],
  "implementation.change":[{stepType:"draft",title:"Prepare approved implementation",toolKey:"cms.draft"},{stepType:"execute",title:"Publish through the authorized connection",toolKey:"cms.publish"},{agentKey:"qa",stepType:"validate",title:"Validate live implementation",toolKey:"seo.validate"}],
  "qa.validate":[{stepType:"validate",title:"Run deployment and SEO validation",toolKey:"seo.validate"},{stepType:"rollback.check",title:"Confirm rollback readiness"}],
  "reporting.summary":[{stepType:"evidence.collect",title:"Collect outcomes, spend, and proof of work",toolKey:"audit.read"},{stepType:"draft",title:"Capture a verifiable outcome snapshot",toolKey:"proof.case_study"},{stepType:"report",title:"Prepare plain-language value summary",toolKey:"report.generate"}],
};

async function ensurePlan(db:SupabaseClient,work:WorkItem){
  const existing=await db.from("agent_work_steps").select("id,sequence").eq("work_item_id",work.id).order("sequence");
  if((existing.data?.length??0)>1)return;
  const plan=stepPlans[work.work_type]??[{stepType:"analyze",title:"Complete assigned work"},{agentKey:"qa",stepType:"validate",title:"Validate the outcome"}];
  const rows=plan.map((step,index)=>({work_item_id:work.id,sequence:index+2,agent_key:step.agentKey??work.assigned_agent_key,step_type:step.stepType,title:step.title,status:index===0?"ready":"pending",tool_key:step.toolKey??null,input:{goal:work.goal}}));
  const inserted=await db.from("agent_work_steps").insert(rows);
  if(inserted.error)throw new ApiError("The supervisor could not save the execution plan.",500,"DATABASE_BINDING_FAILED");
  await db.from("agent_work_steps").update({status:"succeeded",completed_at:now(),output:{riskLevel:work.risk_level,authorizedTools:work.authorized_tools}}).eq("work_item_id",work.id).eq("sequence",1);
  await db.from("agent_work_items").update({proposed_plan:{steps:plan},status:"planning",started_at:work.execution_context?.startedAt??now(),updated_at:now()}).eq("id",work.id);
  await event(db,work,"plan.created","Supervisor prepared the execution plan",`${plan.length} guarded steps assigned.`);
}

async function enforceBudget(db:SupabaseClient,work:WorkItem){
  const client=await db.from("clients").select("automation_config").eq("id",work.client_id).eq("agency_id",work.agency_id).single(),config=asObject(client.data?.automation_config),monthlyBudget=num(config.monthlyBudget);
  const since=new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString();
  const usage=await db.from("data_usage_events").select("estimated_cost,actual_cost").eq("agency_id",work.agency_id).eq("project_id",work.project_id).gte("created_at",since);
  const used=(usage.data??[]).reduce((sum,row)=>sum+num(row.actual_cost??row.estimated_cost),0);
  const remaining=Math.max(0,monthlyBudget-used);
  if(num(work.spending_limit)>remaining&&monthlyBudget>0)return{allowed:false,monthlyBudget,used,remaining};
  return{allowed:true,monthlyBudget,used,remaining};
}

async function enforceApprovals(db:SupabaseClient,work:WorkItem){
  const requirements=asArray(work.required_approvals) as Array<{type?:string;reason?:string}>;
  if(!requirements.length)return true;
  const existing=await db.from("agent_approvals").select("id,approval_type,status,action_digest,expires_at,requested_at").eq("work_item_id",work.id).order("requested_at",{ascending:false}),decisions=new Map(requirements.filter(item=>item.type).map(requirement=>{const decision={workItemId:work.id,approvalType:requirement.type,goal:work.goal,tools:[...work.authorized_tools].sort(),spendingLimit:num(work.spending_limit),riskLevel:work.risk_level,proposedPlan:work.proposed_plan,source:{type:work.source_type,id:work.source_id}};return[requirement.type!,{decision,digest:actionDigest(decision)}]})),status=new Map<string,string>();
  for(const row of existing.data??[]){
    if(status.has(row.approval_type)||!["awaiting","approved","rejected"].includes(row.status))continue;
    const expected=decisions.get(row.approval_type),expired=row.status==="awaiting"&&Boolean(row.expires_at)&&new Date(row.expires_at).getTime()<=Date.now();
    if(expired){await db.from("agent_approvals").update({status:"expired",decision_note:"Approval expired before execution.",decided_at:now()}).eq("id",row.id).eq("status","awaiting");continue;}
    if(expected&&["approved","awaiting"].includes(row.status)&&row.action_digest!==expected.digest){await db.from("agent_approvals").update({status:"cancelled",decision_note:"The protected action changed after this approval was requested.",decided_at:now()}).eq("id",row.id).in("status",["approved","awaiting"]);continue;}
    status.set(row.approval_type,row.status);
  }
  if(requirements.some(requirement=>Boolean(requirement.type)&&status.get(requirement.type!)==="rejected")){await db.from("agent_work_items").update({status:"blocked",final_outcome:{reason:"Required approval was rejected."},updated_at:now()}).eq("id",work.id);return false;}
  const missing=requirements.filter(requirement=>!requirement.type||status.get(requirement.type)!=="approved");
  for(const requirement of missing){if(!requirement.type||status.get(requirement.type)==="awaiting")continue;const protectedAction=decisions.get(requirement.type);if(!protectedAction)continue;const inserted=await db.from("agent_approvals").insert({agency_id:work.agency_id,client_id:work.client_id,project_id:work.project_id,work_item_id:work.id,approval_type:requirement.type,title:`Approve ${work.assigned_agent_key.replaceAll("_"," ")} work`,summary:requirement.reason??work.goal,risk_level:work.risk_level,requested_decision:protectedAction.decision,action_digest:protectedAction.digest,requested_by_agent_key:"supervisor",expires_at:new Date(Date.now()+24*60*60_000).toISOString()});if(inserted.error&&inserted.error.code!=="23505")throw new ApiError("The protected approval request could not be saved.",500,"DATABASE_BINDING_FAILED");}
  if(missing.length){await Promise.all([db.from("agent_work_items").update({status:"awaiting_approval",updated_at:now()}).eq("id",work.id),db.from("agent_work_steps").update({status:"awaiting_approval",updated_at:now()}).eq("work_item_id",work.id).eq("status","ready")]);await event(db,work,"approval.requested","Human approval requested","The supervisor paused execution at a protected decision point.");return false;}
  return true;
}

async function waitForEvidence(db:SupabaseClient,work:WorkItem,reason:string){
  const attempts=num(asObject(work.execution_context).supervisorAttempts)+1;
  if(attempts>=8){await db.from("agent_work_items").update({status:"blocked",execution_context:{...asObject(work.execution_context),supervisorAttempts:attempts},final_outcome:{reason,code:"EVIDENCE_NOT_READY"},updated_at:now()}).eq("id",work.id);await event(db,work,"work.blocked","Agent work blocked",reason);return;}
  await db.from("agent_work_items").update({status:"waiting_for_tools",execution_context:{...asObject(work.execution_context),supervisorAttempts:attempts,waitingReason:reason},updated_at:now()}).eq("id",work.id);
  await db.from("agent_work_steps").update({status:"waiting",output:{reason},updated_at:now()}).eq("work_item_id",work.id).eq("status","ready");
  await event(db,work,"evidence.waiting","Waiting for evidence",reason,{attempt:attempts});
}

async function finish(db:SupabaseClient,work:WorkItem,outcome:Record<string,unknown>,validation:Record<string,unknown>={status:"passed"}){
  const completed=now();
  await db.from("agent_work_steps").update({status:"succeeded",completed_at:completed,output:outcome,validation,updated_at:completed}).eq("work_item_id",work.id).in("status",["ready","running"]);
  await db.from("agent_work_steps").update({status:"skipped",completed_at:completed,output:{reason:"This step was not executed by the completed domain operation."},updated_at:completed}).eq("work_item_id",work.id).in("status",["waiting","pending"]);
  await db.from("agent_work_items").update({status:"succeeded",validation_results:validation,final_outcome:outcome,completed_at:completed,updated_at:completed}).eq("id",work.id);
  await memory(db,work,`${work.work_type}:latest`,"outcome",outcome,[{workItemId:work.id}]);
  await event(db,work,"work.succeeded",`${work.assigned_agent_key.replaceAll("_"," ")} completed its work`,typeof outcome.summary==="string"?outcome.summary:work.goal);
}

async function executeWork(db:SupabaseClient,work:WorkItem){
  await db.from("agent_work_items").update({status:"running",started_at:now(),updated_at:now()}).eq("id",work.id);
  await db.from("agent_work_steps").update({status:"running",started_at:now(),updated_at:now()}).eq("work_item_id",work.id).eq("status","ready");
  if(work.work_type==="onboarding.profile"){
    const [project,website,services,locations,integrations]=await Promise.all([db.from("seo_projects").select("name,domain,industry,primary_market,data_readiness_status").eq("id",work.project_id).single(),db.from("websites").select("site_url,cms_type,status,last_verified_at").eq("project_id",work.project_id).eq("is_primary",true).maybeSingle(),db.from("seo_services").select("name,priority,status").eq("project_id",work.project_id),db.from("seo_locations").select("name,priority,status").eq("project_id",work.project_id),db.from("integration_connections").select("provider,status,selected_resource,last_verified_at").eq("project_id",work.project_id)]);
    const outcome={summary:"Verified business and website profile saved for the agent team.",project:project.data,website:website.data,services:services.data??[],locations:locations.data??[],integrations:integrations.data??[]};
    await toolExecution(db,work,"website.detect","succeeded",{platform:website.data?.cms_type,reachable:website.data?.status==="active"});await finish(db,work,outcome,{status:website.data?.status==="active"?"passed":"warning",websiteReachable:website.data?.status==="active"});return;
  }
  if(work.work_type==="technical.audit"){
    const pages=await db.from("seo_page_snapshots").select("id,url,title,meta_description,h1,canonical,indexable,schema_json_ld_valid,http_status,captured_at").eq("project_id",work.project_id).order("captured_at",{ascending:false}).limit(500);
    if(!pages.data?.length){const website=await db.from("websites").select("id").eq("project_id",work.project_id).eq("is_primary",true).maybeSingle(),client=await db.from("clients").select("organization_id").eq("id",work.client_id).single();if(website.data)await enqueueEvidenceJob(db,{agencyId:work.agency_id,clientId:client.data?.organization_id,projectId:work.project_id,websiteId:website.data.id,jobType:"crawler.crawl",idempotencyKey:`agent-crawl:${work.id}`,priority:95});await waitForEvidence(db,work,"The Technical SEO Agent is waiting for the website crawl to finish.");return;}
    const findings={pages:pages.data.length,missingTitles:pages.data.filter(page=>!page.title).length,missingDescriptions:pages.data.filter(page=>!page.meta_description).length,missingH1:pages.data.filter(page=>!page.h1).length,notIndexable:pages.data.filter(page=>page.indexable===false).length,invalidSchema:pages.data.filter(page=>page.schema_json_ld_valid===false).length},client=await db.from("clients").select("organization_id").eq("id",work.client_id).eq("agency_id",work.agency_id).single();if(!client.data?.organization_id)throw new ApiError("The Technical SEO Agent could not resolve the client organization.",409,"CONFLICT");const linkGraph=await buildInternalLinkGraph(db,{agencyId:work.agency_id,clientId:client.data.organization_id,projectId:work.project_id,userId:work.requested_by});
    await toolExecution(db,work,"seo.validate","succeeded",findings);await toolExecution(db,work,"internal_links.graph","succeeded",linkGraph);await finish(db,work,{summary:`Technical audit completed across ${findings.pages} pages with ${linkGraph.proposals} contextual link proposals.`,findings,linkGraph},{status:"passed",evidenceCount:findings.pages});return;
  }
  if(work.work_type==="research.discovery"){
    const [opportunities,keywords,competitors]=await Promise.all([db.from("seo_opportunities").select("id,action_type,opportunity_score,evidence,status").eq("project_id",work.project_id).order("opportunity_score",{ascending:false}).limit(50),db.from("seo_keywords").select("id",{head:true,count:"exact"}).eq("project_id",work.project_id),db.from("competitor_domains").select("domain,estimated_traffic,intersections").eq("project_id",work.project_id).eq("ignored",false).limit(25)]);
    if(!opportunities.data?.length){await waitForEvidence(db,work,"The Research Agent is waiting for keyword discovery and ranking evidence.");return;}
    const top=opportunities.data.slice(0,10);await toolExecution(db,work,"opportunities.score","succeeded",{analyzed:keywords.count??0,selected:top.length,competitors:competitors.data?.length??0});await finish(db,work,{summary:`Prioritized ${top.length} high-value opportunities from ${keywords.count??0} keyword records.`,topOpportunities:top,competitors:competitors.data??[]},{status:"passed",evidenceCount:(keywords.count??0)+(competitors.data?.length??0)});return;
  }
  if(work.work_type==="strategy.roadmap"){
    const opportunities=await db.from("seo_opportunities").select("id,action_type,opportunity_score,evidence,status").eq("project_id",work.project_id).order("opportunity_score",{ascending:false}).limit(30);
    if(!opportunities.data?.length){await waitForEvidence(db,work,"The Strategy Agent is waiting for the Research Agent to prioritize opportunities.");return;}
    const client=await db.from("clients").select("organization_id,automation_config").eq("id",work.client_id).eq("agency_id",work.agency_id).single();if(!client.data?.organization_id)throw new ApiError("The Strategy Agent could not resolve the client organization.",409,"CONFLICT");const generatedBy=`strategy_agent:${work.id}`,existing=await db.from("growth_plans").select("id,version,status").eq("project_id",work.project_id).eq("generated_by",generatedBy).maybeSingle(),plan=existing.data??await generateGrowthPlan(db,{agencyId:work.agency_id,clientId:client.data.organization_id,projectId:work.project_id,userId:work.requested_by},{monthlyBudget:num(asObject(client.data.automation_config).monthlyBudget),generatedBy});await toolExecution(db,work,"growth.plan","succeeded",{planId:plan.id,status:plan.status??"awaiting_approval"});await finish(db,work,{summary:"Evidence-backed Local Growth Plan prepared across 30, 60, and 90 days. Execution remains approval-gated.",plan},{status:"passed",prioritized:Math.min(opportunities.data.length,20)});return;
  }
  if(work.work_type==="content.plan"){
    const [opportunities,client]=await Promise.all([db.from("seo_opportunities").select("id,action_type,opportunity_score,evidence").eq("project_id",work.project_id).in("action_type",["BUILD","CONTENT","IMPROVE","LOCALIZE"]).order("opportunity_score",{ascending:false}).limit(12),db.from("clients").select("organization_id").eq("id",work.client_id).eq("agency_id",work.agency_id).single()]);if(!opportunities.data?.length){await waitForEvidence(db,work,"The Content Agent is waiting for approved content opportunities.");return;}if(!client.data?.organization_id)throw new ApiError("The Content Agent could not resolve the client organization.",409,"CONFLICT");const refreshes=await evaluateContentRefreshes(db,{agencyId:work.agency_id,clientId:client.data.organization_id,projectId:work.project_id,userId:work.requested_by});
    const specifications=[];for(const item of opportunities.data.slice(0,6))specifications.push(await createCreativeSpec(db,{agencyId:work.agency_id,clientId:client.data.organization_id,projectId:work.project_id,userId:work.requested_by},item.id));
    await toolExecution(db,work,"proof.read","succeeded",{opportunities:opportunities.data.length});await toolExecution(db,work,"content.refresh","succeeded",refreshes);await toolExecution(db,work,"creative.spec","succeeded",{specificationCount:specifications.length,ready:specifications.filter(item=>item.status==="ready").length});await finish(db,work,{summary:`Found ${refreshes.candidates} refresh candidates and compiled ${specifications.length} intent-specific creative specifications. Copy generation remains evidence-gated and review-gated.`,refreshes,specifications},{status:"passed",claimsPublished:0});return;
  }
  if(work.work_type==="local.plan"){
    const [locations,services]=await Promise.all([db.from("seo_locations").select("name,priority").eq("project_id",work.project_id).eq("status","active"),db.from("seo_services").select("name,priority").eq("project_id",work.project_id).eq("status","active")]);if(!locations.data?.length){await waitForEvidence(db,work,"The Local SEO Agent needs at least one verified service area.");return;}const combinations=(locations.data??[]).flatMap(location=>(services.data??[]).slice(0,5).map(service=>({location:location.name,service:service.name}))).slice(0,25);await toolExecution(db,work,"strategy.plan","succeeded",{combinations:combinations.length});await finish(db,work,{summary:`Mapped ${combinations.length} local service opportunities.`,localOpportunities:combinations},{status:"passed",locationCount:locations.data.length});return;
  }
  if(work.work_type==="implementation.change"){
    const packages=await db.from("implementation_packages").select("id,package_data,status,implementation_path,version,created_by,approved_by").eq("agency_id",work.agency_id).eq("project_id",work.project_id).order("created_at",{ascending:false}).limit(10),approved=packages.data?.find(item=>item.status==="client_approved");if(!approved){await waitForEvidence(db,work,"The Implementation Agent needs an exact client-approved implementation package.");return;}const connection=await db.from("cms_connections").select("id,cms_type,connection_mode,status").eq("agency_id",work.agency_id).eq("project_id",work.project_id).eq("status","active").in("cms_type",["wordpress","shopify","webflow"]).order("last_verified_at",{ascending:false}).limit(1).maybeSingle();if(!connection.data){await waitForEvidence(db,work,"The approved package has no verified direct CMS execution path. Repository work remains in the GitHub preview workflow.");return;}const actorId=work.requested_by??approved.approved_by??approved.created_by;if(!actorId)throw new ApiError("The approved package has no accountable publishing actor.",409,"CONFLICT");await toolExecution(db,work,"cms.draft","succeeded",{packageId:approved.id,provider:connection.data.cms_type});const execution=await beginToolExecution(db,work,"cms.publish");let publication:Record<string,unknown>&{id:string};try{publication=await publishCmsPackage(db,{packageId:approved.id,agencyId:work.agency_id,projectId:work.project_id,actorId,idempotencyKey:`agent-cms:${work.id}:${approved.id}:v${approved.version??1}`}) as Record<string,unknown>&{id:string};if(!execution.alreadySucceeded)await completeToolExecution(db,execution.id,"succeeded",{packageId:approved.id,publicationId:publication.id,provider:connection.data.cms_type});}catch(error){if(!execution.alreadySucceeded)await completeToolExecution(db,execution.id,"failed",{code:error instanceof ApiError?error.code:"OPERATION_FAILED",message:error instanceof Error?error.message:"CMS publishing failed."});throw error;}await finish(db,work,{summary:`The exact client-approved package was published to ${connection.data.cms_type} and is awaiting independent live QA.`,packageId:approved.id,publication},{status:"warning",publishing:"completed",verification:"pending"});return;
  }
  if(work.work_type==="qa.validate"){
    const pending=await db.from("implementation_verifications").select("id,package_id,live_url,proof").eq("agency_id",work.agency_id).eq("project_id",work.project_id).eq("status","pending").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(pending.data){
      const pkg=await db.from("implementation_packages").select("id,client_organization_id,package_data,created_by,approved_by").eq("id",pending.data.package_id).eq("agency_id",work.agency_id).eq("project_id",work.project_id).maybeSingle();if(!pkg.data)throw new ApiError("The pending implementation package is unavailable for QA.",409,"CONFLICT");
      const automated=await verifyLiveImplementation({liveUrl:pending.data.live_url,packageData:pkg.data.package_data});await toolExecution(db,work,"seo.validate",automated.passed?"succeeded":"failed",{packageId:pkg.data.id,failed:automated.failed,page:automated.page});
      if(!automated.passed){const saved=await db.from("implementation_verifications").update({checks:automated.checks,error_details:{failed:automated.failed,page:automated.page},updated_at:now()}).eq("id",pending.data.id).eq("status","pending");if(saved.error)throw new ApiError("The failed live QA result could not be recorded.",500,"DATABASE_BINDING_FAILED");await waitForEvidence(db,work,`Live QA is waiting for these required checks to pass: ${automated.failed.join(", ")}.`);return;}
      const actorId=work.requested_by??pkg.data.approved_by??pkg.data.created_by;if(!actorId)throw new ApiError("Live QA has no accountable verification actor.",409,"CONFLICT");const proof=pending.data.proof&&typeof pending.data.proof==="object"&&!Array.isArray(pending.data.proof)?pending.data.proof:{};
      const verified=await db.from("implementation_verifications").update({status:"passed",checks:automated.checks,proof:{...proof,automatedPage:automated.page,qaWorkItemId:work.id},error_details:{},verified_by:actorId,verified_at:now(),updated_at:now()}).eq("id",pending.data.id).eq("status","pending").select("id").maybeSingle();if(verified.error||!verified.data)throw new ApiError("The implementation changed while live QA was running.",409,"CONFLICT");
      const plan=await db.rpc("create_manual_monitoring_plan",{p_package_id:pkg.data.id,p_verified_by:actorId});if(plan.error){await db.from("implementation_verifications").update({status:"pending",verified_by:null,verified_at:null,updated_at:now()}).eq("id",pending.data.id).eq("status","passed");throw new ApiError("Outcome monitoring could not be scheduled after live QA.",500,"DATABASE_BINDING_FAILED");}
      await db.from("proof_of_work_events").insert({agency_id:work.agency_id,client_organization_id:pkg.data.client_organization_id,project_id:work.project_id,package_id:pkg.data.id,event_type:"live_verification_passed",title:"Independent live QA passed",description:"Required page, content, metadata, canonical, schema, internal-link, and indexing checks passed. Outcome monitoring is scheduled.",client_visible:true,actor_user_id:actorId,metadata:{monitoringPlanId:plan.data,page:automated.page,qaWorkItemId:work.id}});
      await finish(db,work,{summary:"Independent live implementation QA passed and outcome monitoring was scheduled.",packageId:pkg.data.id,monitoringPlanId:plan.data,checks:automated.checks},{status:"passed",failedRequiredChecks:0});return;
    }
    const deployment=await db.from("deployments").select("id,status,url,validation_summary,environment,created_at").eq("project_id",work.project_id).order("created_at",{ascending:false}).limit(1).maybeSingle();const checks=deployment.data?await db.from("deployment_checks").select("check_type,status,required,score,details").eq("deployment_id",deployment.data.id):{data:[]};if(!deployment.data){await waitForEvidence(db,work,"The QA Agent is waiting for a deployment or implementation to validate.");return;}const failed=(checks.data??[]).filter(check=>check.required&&check.status==="failed");await toolExecution(db,work,"seo.validate",failed.length?"failed":"succeeded",{deploymentId:deployment.data.id,failed:failed.length});await finish(db,work,{summary:failed.length?`${failed.length} required validation checks failed.`:"Deployment validation passed.",deployment:deployment.data,checks:checks.data??[]},{status:failed.length?"failed":"passed",failedRequiredChecks:failed.length});return;
  }
  if(work.work_type==="reporting.summary"){
    if(work.source_id){const active=await db.from("agent_work_items").select("id",{head:true,count:"exact"}).eq("agency_id",work.agency_id).eq("project_id",work.project_id).eq("source_type",work.source_type).eq("source_id",work.source_id).neq("id",work.id).not("status","in","(succeeded,cancelled,blocked,failed,dead_letter)");if(active.count){await waitForEvidence(db,work,`The Reporting Agent is waiting for ${active.count} specialist work item${active.count===1?"":"s"} to finish.`);return;}}
    const [events,opportunities,usage,client]=await Promise.all([db.from("proof_of_work_events").select("event_type,title,description,occurred_at").eq("project_id",work.project_id).order("occurred_at",{ascending:false}).limit(50),db.from("seo_opportunities").select("id,evidence,status").eq("project_id",work.project_id),db.from("data_usage_events").select("actual_cost,estimated_cost").eq("project_id",work.project_id),db.from("clients").select("organization_id").eq("id",work.client_id).eq("agency_id",work.agency_id).single()]);if(!client.data?.organization_id)throw new ApiError("The Reporting Agent could not resolve the client organization.",409,"CONFLICT");const spent=(usage.data??[]).reduce((sum,row)=>sum+num(row.actual_cost??row.estimated_cost),0),value=(opportunities.data??[]).reduce((sum,row)=>sum+num(asObject(row.evidence).estimated_monthly_value),0),periodEnd=new Date().toISOString().slice(0,10),periodStart=new Date(Date.now()-90*86400000).toISOString().slice(0,10),caseTitle=`Agent outcome snapshot ${work.id}`,existingCase=await db.from("case_study_snapshots").select("id,status").eq("project_id",work.project_id).eq("title",caseTitle).maybeSingle(),caseStudy=existingCase.data??await createCaseStudySnapshot(db,{agencyId:work.agency_id,clientId:client.data.organization_id,projectId:work.project_id,userId:work.requested_by},{title:caseTitle,periodStart,periodEnd});await toolExecution(db,work,"proof.case_study","succeeded",{caseStudyId:caseStudy.id,status:caseStudy.status});await toolExecution(db,work,"report.generate","succeeded",{events:events.data?.length??0,spent,value});await finish(db,work,{summary:`Recorded ${events.data?.length??0} completed actions with $${spent.toFixed(2)} in provider spend and $${value.toFixed(0)} in directional monthly opportunity value.`,moneyUsed:spent,expectedMonthlyValue:value,recentWork:events.data??[],caseStudy},{status:"passed",evidenceCount:events.data?.length??0});return;
  }
  await finish(db,work,{summary:"Agent work completed."});
}

async function supervise(db:SupabaseClient,workItemId:string){
  const result=await db.from("agent_work_items").select("*").eq("id",workItemId).maybeSingle();
  if(!result.data)throw new ApiError("Agent work item not found.",404,"NOT_FOUND");
  const work=result.data as WorkItem;
  if(["succeeded","cancelled","dead_letter"].includes(work.status))return{workItemId,status:work.status};
  await ensurePlan(db,work);
  const budget=await enforceBudget(db,work);
  if(!budget.allowed){
    const protectedDecision={workItemId:work.id,approvalType:"spending",goal:work.goal,requestedLimit:num(work.spending_limit),budget},digest=actionDigest(protectedDecision),existing=await db.from("agent_approvals").select("id,status,action_digest").eq("work_item_id",work.id).eq("approval_type","spending").order("requested_at",{ascending:false}).limit(1).maybeSingle();let existingApproval=existing.data;
    if(existingApproval&&existingApproval.action_digest!==digest&&["awaiting","approved"].includes(existingApproval.status)){await db.from("agent_approvals").update({status:"cancelled",decision_note:"The spending request changed.",decided_at:now()}).eq("id",existingApproval.id).in("status",["awaiting","approved"]);existingApproval=null;}
    if(existingApproval?.status==="rejected"){await db.from("agent_work_items").update({status:"blocked",final_outcome:{reason:"Spending approval was rejected."},updated_at:now()}).eq("id",work.id);return{workItemId,status:"blocked"};}
    if(existingApproval?.status!=="approved"){
      if(!existingApproval)await db.from("agent_approvals").insert({agency_id:work.agency_id,client_id:work.client_id,project_id:work.project_id,work_item_id:work.id,approval_type:"spending",title:"Approve agent spending",summary:`Requested limit $${num(work.spending_limit).toFixed(2)} exceeds the remaining monthly budget of $${budget.remaining.toFixed(2)}.`,risk_level:"high",requested_decision:protectedDecision,action_digest:digest,requested_by_agent_key:"supervisor",expires_at:new Date(Date.now()+24*60*60_000).toISOString()});
      await db.from("agent_work_items").update({status:"awaiting_approval",updated_at:now()}).eq("id",work.id);await event(db,work,"budget.blocked","Supervisor paused work for budget approval",undefined,budget);return{workItemId,status:"awaiting_approval"};
    }
  }
  if(!await enforceApprovals(db,work))return{workItemId,status:"awaiting_approval"};
  await executeWork(db,work);
  return{workItemId,status:"processed"};
}

async function requeueWaiting(db:SupabaseClient){
  const cutoff=new Date(Date.now()-60_000).toISOString(),bucket=Math.floor(Date.now()/300_000),waiting=await db.from("agent_work_items").select("id,agency_id,priority").eq("status","waiting_for_tools").lt("updated_at",cutoff).limit(50);
  for(const work of waiting.data??[]){await db.from("background_jobs").upsert({queue:"agents",job_type:"agent.supervise",agency_id:work.agency_id,payload:{workItemId:work.id},status:"queued",priority:work.priority,available_at:now(),idempotency_key:`agent.reconcile:${work.id}:${bucket}`,updated_at:now()},{onConflict:"queue,idempotency_key"});await db.from("agent_work_items").update({status:"queued",updated_at:now()}).eq("id",work.id).eq("status","waiting_for_tools");}
  return waiting.data?.length??0;
}

export async function processAgentBatch(size=10,workerId=`agents:${crypto.randomUUID()}`){
  const db=requireAdminDb(),requeued=await requeueWaiting(db),claimed=await db.rpc("claim_background_jobs",{p_worker_id:workerId,p_batch_size:size,p_lock_seconds:300,p_queue:"agents"});
  if(claimed.error)throw new ApiError("Agent jobs could not be claimed. Apply migration 0017 and retry.",503,"DATABASE_BINDING_FAILED");
  const jobs=(claimed.data??[]) as BackgroundJob[],results=[];
  for(const job of jobs){let lease:Awaited<ReturnType<typeof startLeaseHeartbeat>>|null=null;try{if(!job.fencing_token)throw new ApiError("The claimed agent job has no fencing token.",500,"INVALID_STATE");lease=await startLeaseHeartbeat(db,{jobId:job.id,workerId,fencingToken:job.fencing_token});const workItemId=String(job.payload?.workItemId??"");if(!workItemId)throw new ApiError("Agent job is missing its work item.",500,"OPERATION_FAILED");const output=await supervise(db,workItemId);await lease.verify();await lease.stop();lease=null;const completed=await db.from("background_jobs").update({status:"succeeded",completed_at:now(),worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:now()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token).select("id").maybeSingle();if(!completed.data){results.push({jobId:job.id,status:"stale_worker"});continue;}results.push({jobId:job.id,...output});}catch(error){await lease?.stop();const safe=safeError(error),retryable=(safe.status===429||safe.status>=500)&&job.attempt_count<job.max_attempts,delay=Math.min(900_000,15_000*2**Math.max(0,job.attempt_count-1))+Math.floor(Math.random()*5000),status=retryable?"retry_scheduled":job.attempt_count>=job.max_attempts?"dead_letter":"failed";await db.from("background_jobs").update({status,available_at:new Date(Date.now()+delay).toISOString(),last_error_code:safe.body.error.code,last_error_message:safe.body.error.message,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:now()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token);const workItemId=String(job.payload?.workItemId??"");if(workItemId&&!retryable)await db.from("agent_work_items").update({status:status==="dead_letter"?"dead_letter":"failed",failed_at:now(),final_outcome:{code:safe.body.error.code,message:safe.body.error.message},updated_at:now()}).eq("id",workItemId);results.push({jobId:job.id,status,error:safe.body.error});}}
  await db.from("system_heartbeats").upsert({component:"agents",status:results.some(result=>result.status==="failed"||result.status==="dead_letter")?"degraded":"healthy",worker_id:workerId,last_seen_at:now(),metadata:{claimed:jobs.length,requeued},updated_at:now()},{onConflict:"component"});
  return{claimed:jobs.length,requeued,results};
}
