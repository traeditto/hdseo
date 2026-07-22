import "server-only";
import { ApiError,logEvent,safeError } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { requireAdminDb } from "./control-plane";
import { loadVercelCredentials } from "@/lib/vercel/credentials";
import { createVercelDeployment,getVercelDeployment,getVercelDeploymentEvents,rollbackVercelProject } from "@/lib/vercel/client";
import { validateDeploymentUrl,type ValidationCheck } from "./validator";
import { ensureVercelAutomationBypass } from "@/lib/vercel/protection-bypass";
import { compareSeoDrift,deploymentSnapshotFromChecks } from "@/lib/seo/drift";
import {claimStoredMutationIntent,requestMutationIntent,settleMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";
import {releaseAutopilotPreview} from "@/lib/execution/autopilot-release";

interface BackgroundJob{id:string;job_type:string;agency_id:string;automation_run_id:string|null;deployment_id:string|null;payload:Record<string,unknown>;attempt_count:number;max_attempts:number;fencing_token:string|null}
type SafetyMetadata={mutationIntentId:string;actionDigest:string;traceId?:string;approvalPolicy?:string};
const terminalStates=new Set(["READY","ERROR","CANCELED"]);
async function addLog(deploymentId:string,source:string,level:string,message:string,metadata:Record<string,unknown>={}){const db=requireAdminDb();await db.from("deploy_logs").upsert({deployment_id:deploymentId,sequence:Date.now()*1000+Math.floor(Math.random()*1000),source,level,message,metadata},{onConflict:"deployment_id,source,sequence"})}
async function setRun(runId:string|null,status:string,stage:string,error?:{code:string;message:string}){if(!runId)return;const db=requireAdminDb(),run=await db.from("automation_runs").select("seo_job_id").eq("id",runId).single(),now=new Date().toISOString();await db.from("automation_runs").update({status,current_stage:stage,error_code:error?.code??null,error_message:error?.message??null,started_at:status==="running"?now:undefined,completed_at:["succeeded","failed"].includes(status)?now:null,updated_at:now}).eq("id",runId);if(run.data)await db.from("seo_jobs").update({status,started_at:status==="running"?now:undefined,completed_at:status==="succeeded"?now:null,failed_at:status==="failed"?now:null,updated_at:now}).eq("id",run.data.seo_job_id)}
async function deploymentContext(id:string){const db=requireAdminDb(),deployment=await db.from("deployments").select("*").eq("id",id).single();if(!deployment.data)throw new ApiError("Deployment record not found.",404,"NOT_FOUND");const project=await db.from("vercel_projects").select("*").eq("id",deployment.data.vercel_project_id).single(),repository=deployment.data.repository_id?await db.from("repositories").select("*").eq("id",deployment.data.repository_id).single():null;if(!project.data)throw new ApiError("Vercel project record not found.",404,"NOT_FOUND");return{db,deployment:deployment.data,project:project.data,repository:repository?.data??null}}
function safetyMetadata(job:BackgroundJob,deployment:Record<string,unknown>){const payload=(job.payload?.safety&&typeof job.payload.safety==="object"?job.payload.safety:null) as SafetyMetadata|null,provider=(deployment.provider_metadata&&typeof deployment.provider_metadata==="object"?(deployment.provider_metadata as Record<string,unknown>).safety:null) as SafetyMetadata|null,safety=payload??provider;if(!safety?.mutationIntentId||!safety.actionDigest)throw new ApiError("This external write is missing its protected action authorization.",409,"APPROVAL_REQUIRED");return safety;}
async function failClaimedMutation(db:ReturnType<typeof requireAdminDb>,job:BackgroundJob,code:string,message:string){const safety=(job.payload?.safety&&typeof job.payload.safety==="object"?job.payload.safety:null) as SafetyMetadata|null;if(!safety?.mutationIntentId)return;try{await settleMutationIntent(db,{intentId:safety.mutationIntentId,executionRef:job.id,status:"failed",errorCode:code,errorMessage:message});}catch{/* An unclaimed or reconciliation-required intent must remain untouched. */}}

function protectionRedirect(checks:ValidationCheck[]){
  const health=checks.find(check=>check.checkType==="health");
  return health?.status==="failed"&&(
    health.details.error==="Protected preview redirected outside its verified origin."||
    health.details.reason==="vercel_deployment_protection"
  );
}

function transientPreviewFailure(checks:ValidationCheck[]){
  const health=checks.find(check=>check.checkType==="health");
  if(!health||health.status!=="failed")return false;
  const status=Number(health.details.status),error=String(health.details.error??"").toLowerCase();
  return protectionRedirect(checks)||[401,403,429].includes(status)||status>=500||error.includes("abort")||error.includes("timeout")||error.includes("fetch failed");
}

async function saveBypassConfig(db:ReturnType<typeof requireAdminDb>,projectId:string,agencyId:string,environmentConfig:Record<string,unknown>){
  const saved=await db.from("vercel_projects").update({environment_config:environmentConfig,updated_at:new Date().toISOString()}).eq("id",projectId).eq("agency_id",agencyId);
  if(saved.error)throw new ApiError("The protected preview credential could not be stored safely.",500,"DATABASE_BINDING_FAILED");
}

async function reconcileCampaignForExecution(db:ReturnType<typeof requireAdminDb>,executionId:string,outcomeRunId:string|null,status:"ready"|"failed",message?:string){
  const now=new Date().toISOString();
  if(status==="ready"){
    await db.from("seo_campaign_jobs").update({status:"awaiting_release_approval",current_stage:"release_preview",error_code:null,error_message:null,error_details:{},worker_id:null,locked_at:null,lock_expires_at:null,heartbeat_at:null,updated_at:now}).contains("result",{executionId});
    if(outcomeRunId){
      await Promise.all([
        db.from("outcome_loop_runs").update({status:"awaiting_approval",current_step:"approval",failure_code:null,failure_message:null,updated_at:now}).eq("id",outcomeRunId),
        db.from("outcome_loop_steps").update({status:"succeeded",completed_at:now,updated_at:now}).eq("run_id",outcomeRunId).eq("step_key","qa"),
        db.from("outcome_loop_steps").update({status:"awaiting_approval",updated_at:now}).eq("run_id",outcomeRunId).eq("step_key","approval"),
      ]);
    }
    return;
  }
  const failureMessage=message??"The preview did not pass required safety checks. Nothing was published.";
  await db.from("seo_campaign_jobs").update({status:"failed",error_code:"PREVIEW_QA_FAILED",error_message:failureMessage,failed_at:now,worker_id:null,locked_at:null,lock_expires_at:null,heartbeat_at:null,updated_at:now}).contains("result",{executionId});
  if(outcomeRunId)await db.from("outcome_loop_runs").update({status:"failed",failure_code:"PREVIEW_QA_FAILED",failure_message:failureMessage,completed_at:now,updated_at:now}).eq("id",outcomeRunId);
}

async function reconcilePreviewCampaigns(db:ReturnType<typeof requireAdminDb>){
  const failedHealth=await db.from("deployment_checks").select("deployment_id,details,updated_at").eq("check_type","health").eq("status","failed").order("updated_at",{ascending:false}).limit(20);
  let recovered=0,advanced=0,autopilotReleased=0;const releaseErrors:Array<{executionId:string;code:string;message:string}>=[];
  for(const health of failedHealth.data??[]){
    const details=health.details as Record<string,unknown>|null;
    if(details?.error!=="Protected preview redirected outside its verified origin."&&details?.reason!=="vercel_deployment_protection")continue;
    const deployment=await db.from("deployments").select("id,status,validation_summary").eq("id",health.deployment_id).maybeSingle();
    if(deployment.data?.status!=="failed")continue;
    const execution=await db.from("seo_executions").select("id,status,outcome_run_id").eq("preview_deployment_id",health.deployment_id).maybeSingle();
    if(!execution.data||execution.data.status!=="preview_failed")continue;
    const summary=(deployment.data.validation_summary&&typeof deployment.data.validation_summary==="object"?deployment.data.validation_summary:{}) as Record<string,unknown>;
    if(Number(summary.recoveryAttempts??0)>=1)continue;
    const now=new Date().toISOString();
    await Promise.all([
      db.from("deployments").update({status:"ready",validation_summary:{...summary,recoveryAttempts:1,recoveryReason:"vercel_protection_bypass_rotation"},completed_at:null,updated_at:now}).eq("id",health.deployment_id),
      db.from("seo_executions").update({status:"preview_queued",preview_validated_at:null,updated_at:now}).eq("id",execution.data.id),
      db.from("background_jobs").update({status:"retry_scheduled",attempt_count:0,available_at:now,completed_at:null,last_error_code:null,last_error_message:null,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:now}).eq("deployment_id",health.deployment_id).eq("job_type","deployment.validate"),
    ]);
    recovered+=1;
  }
  const readyExecutions=await db.from("seo_executions").select("id,outcome_run_id,preview_deployment_id").eq("status","preview_ready").not("preview_deployment_id","is",null).order("updated_at",{ascending:false}).limit(20);
  for(const execution of readyExecutions.data??[]){
    const campaigns=await db.from("seo_campaign_jobs").select("id").contains("result",{executionId:execution.id}).eq("status","awaiting_preview_validation");
    if(campaigns.data?.length){await reconcileCampaignForExecution(db,execution.id,execution.outcome_run_id,"ready");advanced+=campaigns.data.length;}
    if(execution.outcome_run_id){
      const details=await db.from("seo_executions").select("agency_id,client_organization_id,project_id").eq("id",execution.id).maybeSingle();
      if(details.data)try{const released=await releaseAutopilotPreview(db,{executionId:execution.id,agencyId:details.data.agency_id,clientId:details.data.client_organization_id,projectId:details.data.project_id});if(released.released)autopilotReleased++;}catch(error){const safe=safeError(error);releaseErrors.push({executionId:execution.id,code:safe.body.error.code,message:safe.body.error.message});logEvent("autopilot_release_reconciliation_failed",{executionId:execution.id,agencyId:details.data.agency_id,projectId:details.data.project_id,status:"deferred",errorCode:safe.body.error.code,stage:"release_preview"});}
    }
  }
  const legacyPolicyFailures=await db.from("deployments").select("id,validation_summary").eq("environment","preview").eq("status","failed").order("updated_at",{ascending:false}).limit(20);
  let policyRecovered=0;
  for(const deployment of legacyPolicyFailures.data??[]){
    const summary=(deployment.validation_summary&&typeof deployment.validation_summary==="object"?deployment.validation_summary:{}) as Record<string,unknown>,failed=Array.isArray(summary.failed)?summary.failed.map(String):[];
    if(summary.validationModelVersion||!failed.length||failed.some(check=>!["seo","robots","indexing_readiness"].includes(check)))continue;
    const execution=await db.from("seo_executions").select("id,status,outcome_run_id").eq("preview_deployment_id",deployment.id).maybeSingle();
    if(!execution.data||execution.data.status!=="preview_failed")continue;
    const now=new Date().toISOString();
    await Promise.all([
      db.from("deployments").update({status:"ready",validation_summary:{...summary,policyRecoveryAttempts:1,policyRecoveryReason:"preview_indexing_policy_upgrade"},completed_at:null,updated_at:now}).eq("id",deployment.id),
      db.from("seo_executions").update({status:"preview_queued",preview_validated_at:null,updated_at:now}).eq("id",execution.data.id),
      db.from("seo_campaign_jobs").update({status:"awaiting_preview_validation",current_stage:"create_pr",error_code:null,error_message:null,failed_at:null,updated_at:now}).contains("result",{executionId:execution.data.id}),
      db.from("background_jobs").update({status:"retry_scheduled",attempt_count:0,available_at:now,completed_at:null,last_error_code:null,last_error_message:null,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:now}).eq("deployment_id",deployment.id).eq("job_type","deployment.validate"),
      execution.data.outcome_run_id?db.from("outcome_loop_runs").update({status:"preview",current_step:"preview",failure_code:null,failure_message:null,completed_at:null,updated_at:now}).eq("id",execution.data.outcome_run_id):Promise.resolve({error:null}),
    ]);
    policyRecovered+=1;
  }
  return{recovered,policyRecovered,advanced,autopilotReleased,releaseErrors};
}

async function createDeployment(job:BackgroundJob){if(!job.deployment_id)throw new ApiError("Deployment job is incomplete.",500,"OPERATION_FAILED");const{db,deployment,project,repository}=await deploymentContext(job.deployment_id);if(!repository)throw new ApiError("Repository record not found.",404,"NOT_FOUND");const safety=safetyMetadata(job,deployment);await claimStoredMutationIntent(db,{intentId:safety.mutationIntentId,agencyId:job.agency_id,projectId:deployment.project_id,toolKey:"vercel.deploy",expectedDigest:safety.actionDigest,executionRef:job.id});const credentials=await loadVercelCredentials(project.connection_id,job.agency_id),now=new Date().toISOString();await db.from("deployments").update({status:"creating",started_at:now,updated_at:now}).eq("id",deployment.id);await setRun(job.automation_run_id,"running","deployment.create");const created=await createVercelDeployment(credentials,{projectId:project.vercel_project_id,projectName:project.name,repositoryId:String(repository.github_repository_id),ref:deployment.git_ref,sha:deployment.git_sha??undefined,environment:deployment.environment,metadata:{hdSeoDeploymentId:deployment.id,hdSeoRunId:job.automation_run_id??"",githubCommitSha:deployment.git_sha??"",projectId:project.vercel_project_id,hdSeoMutationIntentId:safety.mutationIntentId,hdSeoActionDigest:safety.actionDigest}});const saved=await db.from("deployments").update({external_deployment_id:created.id,url:created.url,status:created.readyState==="READY"?"ready":"building",provider_metadata:{...created,safety},updated_at:new Date().toISOString()}).eq("id",deployment.id);if(saved.error)throw new ApiError("The Vercel deployment succeeded but reconciliation must complete before retrying.",503,"DATABASE_BINDING_FAILED");await settleMutationIntent(db,{intentId:safety.mutationIntentId,executionRef:job.id,status:"succeeded"});await addLog(deployment.id,"vercel","info","Vercel deployment created.",{providerDeploymentId:created.id,url:created.url});await db.from("background_jobs").upsert({queue:"deployments",job_type:created.readyState==="READY"?"deployment.validate":"deployment.poll",agency_id:job.agency_id,automation_run_id:job.automation_run_id,deployment_id:deployment.id,payload:{},status:"queued",priority:created.readyState==="READY"?80:60,available_at:new Date(Date.now()+(created.readyState==="READY"?0:20_000)).toISOString(),idempotency_key:`${created.readyState==="READY"?"deployment.validate":"deployment.poll"}:${deployment.id}`},{onConflict:"queue,idempotency_key",ignoreDuplicates:true});}

async function pollDeployment(job:BackgroundJob){if(!job.deployment_id)throw new ApiError("Poll job is incomplete.",500,"OPERATION_FAILED");const{db,deployment,project}=await deploymentContext(job.deployment_id);if(!deployment.external_deployment_id)throw new ApiError("Vercel deployment ID is not available yet.",503,"OPERATION_FAILED");const credentials=await loadVercelCredentials(project.connection_id,job.agency_id),provider=await getVercelDeployment(credentials,deployment.external_deployment_id),state=(provider.readyState??"").toUpperCase(),previousMetadata=deployment.provider_metadata&&typeof deployment.provider_metadata==="object"?deployment.provider_metadata:{};await db.from("deployments").update({status:state==="READY"?"ready":state==="ERROR"?"failed":"building",url:provider.url??deployment.url,ready_at:state==="READY"?new Date().toISOString():null,completed_at:state==="ERROR"?new Date().toISOString():null,provider_metadata:{...previousMetadata,provider},updated_at:new Date().toISOString()}).eq("id",deployment.id);if(!terminalStates.has(state))throw new ApiError("Vercel deployment is still building.",503,"OPERATION_FAILED");try{const events=await getVercelDeploymentEvents(credentials,deployment.external_deployment_id);for(const [index,event] of events.entries())await db.from("deploy_logs").upsert({deployment_id:deployment.id,sequence:event.date??event.created??index,source:"vercel",level:event.type==="stderr"?"error":"info",message:(event.text??event.type??"Vercel event").slice(0,10_000),metadata:event},{onConflict:"deployment_id,source,sequence",ignoreDuplicates:true})}catch{await addLog(deployment.id,"vercel","warn","Deployment completed, but build logs could not be collected.")};if(state==="ERROR"){await setRun(job.automation_run_id,"failed","deployment.failed",{code:"VERCEL_DEPLOYMENT_FAILED",message:"Vercel reported a failed deployment."});return}await db.from("background_jobs").upsert({queue:"deployments",job_type:"deployment.validate",agency_id:job.agency_id,automation_run_id:job.automation_run_id,deployment_id:deployment.id,payload:{},status:"queued",priority:80,idempotency_key:`deployment.validate:${deployment.id}`},{onConflict:"queue,idempotency_key",ignoreDuplicates:true});}

async function validateDeployment(job:BackgroundJob){
  if(!job.deployment_id)throw new ApiError("Validation job is incomplete.",500,"OPERATION_FAILED");
  const{db,deployment,project}=await deploymentContext(job.deployment_id);
  if(!deployment.url)throw new ApiError("Deployment URL is not available.",503,"OPERATION_FAILED");
  const executionContext=await db.from("seo_executions").select("id,validation_results,outcome_run_id,opportunity_id,client_organization_id").eq("preview_deployment_id",deployment.id).maybeSingle(),opportunity=executionContext.data?.opportunity_id?await db.from("seo_opportunities").select("target_url").eq("id",executionContext.data.opportunity_id).maybeSingle():{data:null},targetPath=opportunity.data?.target_url?new URL(opportunity.data.target_url,"https://hdseo.invalid").pathname:"/",validationUrl=new URL(targetPath,deployment.url.startsWith("http")?deployment.url:`https://${deployment.url}`).toString();
  const previous=await db.from("deployments").select("id").eq("vercel_project_id",deployment.vercel_project_id).eq("environment",deployment.environment).eq("status","healthy").neq("id",deployment.id).order("completed_at",{ascending:false}).limit(1).maybeSingle();
  const baselineChecks=previous.data?await db.from("deployment_checks").select("check_type,score,details").eq("deployment_id",previous.data.id):{data:[]};
  const baseline=previous.data?deploymentSnapshotFromChecks(baselineChecks.data??[]):null;
  await db.from("deployments").update({status:"validating",updated_at:new Date().toISOString()}).eq("id",deployment.id);
  await setRun(job.automation_run_id,"running","deployment.validate");
  const credentials=await loadVercelCredentials(project.connection_id,job.agency_id);
  let bypass=await ensureVercelAutomationBypass({credentials,projectId:project.vercel_project_id,environmentConfig:project.environment_config});
  if(bypass.created)await saveBypassConfig(db,project.id,job.agency_id,bypass.environmentConfig);
  const started=new Date().toISOString();
  let checks=await validateDeploymentUrl(validationUrl,{protectionBypassSecret:bypass.secret,environment:deployment.environment});
  if(protectionRedirect(checks)){
    bypass=await ensureVercelAutomationBypass({credentials,projectId:project.vercel_project_id,environmentConfig:bypass.environmentConfig,forceRefresh:true});
    await saveBypassConfig(db,project.id,job.agency_id,bypass.environmentConfig);
    await addLog(deployment.id,"hdseo","warn","Vercel preview access expired; HD SEO rotated it and retried validation.",{reason:"protection_bypass_rotation"});
    checks=await validateDeploymentUrl(validationUrl,{protectionBypassSecret:bypass.secret,environment:deployment.environment});
  }
  if(transientPreviewFailure(checks)){
    const health=checks.find(check=>check.checkType==="health");
    await db.from("deployments").update({status:"ready",validation_summary:{retrying:true,reason:"temporary_preview_access",health:health?.details??{}},completed_at:null,updated_at:new Date().toISOString()}).eq("id",deployment.id);
    throw new ApiError("The preview is temporarily unavailable. HD SEO will retry automatically.",503,"PREVIEW_VALIDATION_RETRY");
  }
  const current=deploymentSnapshotFromChecks(checks),drift=compareSeoDrift(baseline,current);
  checks.push({checkType:"drift",status:drift.status,required:drift.required,details:{baselineDeploymentId:previous.data?.id??null,findings:drift.findings,baseline:drift.baseline,current:drift.current}});
  for(const check of checks){const saved=await db.from("deployment_checks").upsert({deployment_id:deployment.id,check_type:check.checkType,status:check.status,required:check.required,score:check.score??null,details:check.details,started_at:started,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"deployment_id,check_type"});if(saved.error)throw new ApiError(`The ${check.checkType} validation result could not be persisted.`,500,"DATABASE_BINDING_FAILED");}
  const failed=checks.filter(check=>check.required&&check.status==="failed"),summary={passed:checks.filter(c=>c.status==="passed").length,warnings:checks.filter(c=>c.status==="warning").length,failed:failed.map(c=>c.checkType),checks:checks.length,baselineDeploymentId:previous.data?.id??null,validationModelVersion:"preview-aware-v2",validatedUrl:validationUrl};
  await db.from("deployments").update({status:failed.length?"failed":"healthy",validation_summary:summary,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",deployment.id);
  const client=await db.from("clients").select("organization_id,automation_config").eq("id",deployment.client_id).single(),run=job.automation_run_id?await db.from("automation_runs").select("seo_job_id").eq("id",job.automation_run_id).single():null,seoJob=run?.data?await db.from("seo_jobs").select("requested_by").eq("id",run.data.seo_job_id).single():null;
  const execution=executionContext;
  if(execution.data){
    await db.from("seo_executions").update({status:failed.length?"preview_failed":"preview_ready",preview_url:deployment.url,preview_validated_at:new Date().toISOString(),validation_results:{...(execution.data.validation_results??{}),preview:{status:failed.length?"failed":"healthy",deploymentId:deployment.id,url:deployment.url,summary,checks}}}).eq("id",execution.data.id);
    await reconcileCampaignForExecution(db,execution.data.id,execution.data.outcome_run_id,failed.length?"failed":"ready",failed.length?`The preview failed required checks: ${failed.map(item=>item.checkType).join(", ")}. Nothing was published.`:undefined);
    if(!failed.length&&execution.data.outcome_run_id)await releaseAutopilotPreview(db,{executionId:execution.data.id,agencyId:deployment.agency_id,clientId:execution.data.client_organization_id,projectId:deployment.project_id});
    const clientVisibleBody=failed.length?`The preview failed required checks: ${failed.map(item=>item.checkType).join(", ")}. Nothing was published.`:"The preview passed all required checks. Review the exact change and preview before authorizing the repository merge.";
    await db.from("notifications").insert({agency_id:deployment.agency_id,client_organization_id:client.data?.organization_id??null,project_id:deployment.project_id,user_id:seoJob?.data?.requested_by??null,event_type:failed.length?"seo.preview_failed":"seo.preview_ready",title:failed.length?"SEO preview needs revision":"SEO preview ready for final review",body:clientVisibleBody,status:"sent",sent_at:new Date().toISOString(),client_visible:true,metadata:{executionId:execution.data.id,deploymentId:deployment.id,url:deployment.url,summary}});
  }
  await addLog(deployment.id,"hdseo",failed.length?"error":"info",failed.length?`Deployment validation failed: ${failed.map(item=>item.checkType).join(", ")}.`:"All required deployment validations passed.",summary);
  await setRun(job.automation_run_id,failed.length?"failed":"succeeded",failed.length?"deployment.validation_failed":"completed",failed.length?{code:"DEPLOYMENT_VALIDATION_FAILED",message:`Required checks failed: ${failed.map(item=>item.checkType).join(", ")}`} : undefined);
  await db.from("notifications").insert({agency_id:deployment.agency_id,client_organization_id:client.data?.organization_id??null,project_id:deployment.project_id,user_id:seoJob?.data?.requested_by??null,event_type:failed.length?"deployment.failed":"deployment.healthy",title:failed.length?"Deployment validation failed":"Deployment is healthy",body:failed.length?`Required checks failed: ${failed.map(item=>item.checkType).join(", ")}.`:"HD SEO completed health, Lighthouse, SEO, schema, sitemap, robots.txt, indexing-readiness, and drift validation.",status:"sent",sent_at:new Date().toISOString(),metadata:{deploymentId:deployment.id,url:deployment.url,summary}});
  if(failed.length&&deployment.environment==="production"&&(client.data?.automation_config as {autoRollback?:boolean}|undefined)?.autoRollback&&previous.data&&client.data?.organization_id){
    const idempotencyKey=`auto-rollback:${deployment.id}:${previous.data.id}`,action:MutationAction={agencyId:deployment.agency_id,clientId:client.data.organization_id,projectId:deployment.project_id,toolKey:"vercel.rollback",resourceType:"deployment",resourceId:deployment.id,environment:"production",payload:{sourceDeploymentId:deployment.id,targetDeploymentId:previous.data.id}},intent=await requestMutationIntent(db,{action,summary:"Automatically restore the previous healthy production deployment after required QA failed.",riskLevel:"critical",approvalPolicy:"system_rollback",requestedBy:null,idempotencyKey:`mutation:${idempotencyKey}`}),queued=await db.rpc("enqueue_rollback_job",{p_agency_id:deployment.agency_id,p_source_deployment_id:deployment.id,p_target_deployment_id:previous.data.id,p_requested_by:null,p_idempotency_key:idempotencyKey});
    const result=queued.data as {deploymentId?:string;runId?:string}|null;if(queued.error||!result?.deploymentId)throw new ApiError("Automatic rollback could not be queued.",500,"DATABASE_BINDING_FAILED");const safety={mutationIntentId:intent.id,actionDigest:intent.action_digest,traceId:intent.trace_id,approvalPolicy:intent.approval_policy};const [deploymentBound,jobBound]=await Promise.all([db.from("deployments").update({provider_metadata:{safety},updated_at:new Date().toISOString()}).eq("id",result.deploymentId),db.from("background_jobs").update({payload:{sourceDeploymentId:deployment.id,targetDeploymentId:previous.data.id,safety},updated_at:new Date().toISOString()}).eq("automation_run_id",result.runId).eq("deployment_id",result.deploymentId).eq("job_type","deployment.rollback")]);if(deploymentBound.error||jobBound.error)throw new ApiError("Automatic rollback authorization could not be bound.",500,"DATABASE_BINDING_FAILED");
  }
}

async function rollbackDeployment(job:BackgroundJob){if(!job.deployment_id)throw new ApiError("Rollback job is incomplete.",500,"OPERATION_FAILED");const{db,deployment,project}=await deploymentContext(job.deployment_id),targetId=deployment.previous_deployment_id as string|null;if(!targetId)throw new ApiError("Rollback target is missing.",409,"CONFLICT");const safety=safetyMetadata(job,deployment);await claimStoredMutationIntent(db,{intentId:safety.mutationIntentId,agencyId:job.agency_id,projectId:deployment.project_id,toolKey:"vercel.rollback",expectedDigest:safety.actionDigest,executionRef:job.id});const target=await db.from("deployments").select("external_deployment_id,url").eq("id",targetId).single();if(!target.data?.external_deployment_id)throw new ApiError("Rollback target is not a Vercel production deployment.",409,"CONFLICT");await db.from("deployments").update({status:"rolling_back",started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",deployment.id);await setRun(job.automation_run_id,"running","deployment.rollback");const credentials=await loadVercelCredentials(project.connection_id,job.agency_id);await rollbackVercelProject(credentials,project.vercel_project_id,target.data.external_deployment_id,`HD SEO rollback ${deployment.id}`);const saved=await db.from("deployments").update({status:"rolled_back",url:target.data.url,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",deployment.id);if(saved.error)throw new ApiError("Rollback completed at Vercel but its local record requires reconciliation.",503,"DATABASE_BINDING_FAILED");if(deployment.rollback_of_id)await db.from("deployments").update({status:"rolled_back",updated_at:new Date().toISOString()}).eq("id",deployment.rollback_of_id);await settleMutationIntent(db,{intentId:safety.mutationIntentId,executionRef:job.id,status:"succeeded"});await setRun(job.automation_run_id,"succeeded","completed");await addLog(deployment.id,"vercel","warn","Production traffic was rolled back to a prior healthy deployment.",{targetDeploymentId:targetId,targetProviderDeploymentId:target.data.external_deployment_id});}

const handlers:Record<string,(job:BackgroundJob)=>Promise<void>>={"deployment.create":createDeployment,"deployment.poll":pollDeployment,"deployment.validate":validateDeployment,"deployment.rollback":rollbackDeployment};
export async function processDeploymentBatch(size=env.AUTOMATION_JOB_BATCH_SIZE,workerId=`automation:${crypto.randomUUID()}`){const db=requireAdminDb(),reconciliation=await reconcilePreviewCampaigns(db),claimed=await db.rpc("claim_background_jobs",{p_worker_id:workerId,p_batch_size:size,p_lock_seconds:300,p_queue:"deployments"});if(claimed.error)throw new Error("Background jobs could not be claimed.");const jobs=(claimed.data??[]) as BackgroundJob[],results=[];for(const job of jobs){const handler=handlers[job.job_type];try{if(!handler)throw new ApiError(`Unknown background job type: ${job.job_type}`,500,"OPERATION_FAILED");if(!job.fencing_token)throw new ApiError("The claimed deployment job has no fencing token.",500,"INVALID_STATE");const lease=await db.rpc("extend_background_job_lease",{p_job_id:job.id,p_worker_id:workerId,p_fencing_token:job.fencing_token,p_lock_seconds:300});if(lease.error||!lease.data)throw new ApiError("The deployment worker lost its job lease.",409,"CONFLICT");await handler(job);const completed=await db.from("background_jobs").update({status:"succeeded",completed_at:new Date().toISOString(),worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token).select("id").maybeSingle();if(!completed.data){results.push({jobId:job.id,status:"stale_worker"});continue;}results.push({jobId:job.id,status:"succeeded"});logEvent("automation_job_completed",{jobId:job.id,agencyId:job.agency_id,status:"succeeded",stage:job.job_type})}catch(error){const safe=safeError(error),retryable=(safe.status===429||safe.status>=500)&&job.attempt_count<job.max_attempts,delay=Math.min(900_000,15_000*2**Math.max(0,job.attempt_count-1))+Math.floor(Math.random()*5000),status=retryable?"retry_scheduled":job.attempt_count>=job.max_attempts?"dead_letter":"failed";await db.from("background_jobs").update({status,available_at:new Date(Date.now()+delay).toISOString(),last_error_code:safe.body.error.code,last_error_message:safe.body.error.message,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token);if(!retryable){if(safe.body.error.code!=="DATABASE_BINDING_FAILED")await failClaimedMutation(db,job,safe.body.error.code,safe.body.error.message);await setRun(job.automation_run_id,"failed",job.job_type,{code:safe.body.error.code,message:safe.body.error.message});if(job.job_type==="deployment.validate"&&job.deployment_id){const execution=await db.from("seo_executions").select("id,outcome_run_id").eq("preview_deployment_id",job.deployment_id).maybeSingle();if(execution.data)await reconcileCampaignForExecution(db,execution.data.id,execution.data.outcome_run_id,"failed",safe.body.error.message);}}results.push({jobId:job.id,status,error:safe.body.error});logEvent("automation_job_failed",{jobId:job.id,agencyId:job.agency_id,status,errorCode:safe.body.error.code,stage:job.job_type})}}return{reconciliation,claimed:jobs.length,results}}
