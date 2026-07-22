import "server-only";
import { ApiError,logEvent,safeError } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { requireAdminDb } from "./control-plane";
import { loadVercelCredentials } from "@/lib/vercel/credentials";
import { createVercelDeployment,getVercelDeployment,getVercelDeploymentEvents,listVercelDeployments,listVercelProjectDomains,rollbackVercelProject,type VercelCredentials } from "@/lib/vercel/client";
import { validateDeploymentUrl,type ValidationCheck } from "./validator";
import { ensureVercelAutomationBypass } from "@/lib/vercel/protection-bypass";
import { compareSeoDrift,deploymentSnapshotFromChecks } from "@/lib/seo/drift";
import {claimStoredMutationIntent,requestMutationIntent,settleMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";
import {releaseAutopilotPreview} from "@/lib/execution/autopilot-release";
import {previewContinuationJobIsActive,type PreviewContinuationJobState} from "./job-state";
import {isGeneratedVercelHostname,productionValidationCandidates,verifiedProviderHostnames,type ProductionValidationCandidate,type ProviderDomain} from "./validation-target";
import {reconcileHealthyProductionOutcome,reconcileRecentHealthyProductionOutcomes} from "./outcome-reconciliation";
import {providerDeploymentIso,selectPriorProductionDeployment} from "./rollback-baseline";

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

async function loadProductionValidationTargets(
  db:ReturnType<typeof requireAdminDb>,
  input:{agencyId:string;projectId:string;vercelProject:{id:string;connection_id:string;vercel_project_id:string;production_domains?:unknown};credentials?:VercelCredentials},
){
  const seoProject=await db.from("seo_projects").select("domain,canonical_domain").eq("id",input.projectId).eq("agency_id",input.agencyId).maybeSingle();
  if(seoProject.error)throw new ApiError("The production website address could not be loaded.",500,"DATABASE_BINDING_FAILED");
  let providerDomains:ProviderDomain[]=[];
  try{
    const credentials=input.credentials??await loadVercelCredentials(input.vercelProject.connection_id,input.agencyId);
    const response=await listVercelProjectDomains(credentials,input.vercelProject.vercel_project_id);
    providerDomains=response.domains??[];
  }catch(error){
    const safe=safeError(error);
    logEvent("production_domain_sync_deferred",{agencyId:input.agencyId,projectId:input.projectId,status:"deferred",errorCode:safe.body.error.code,stage:"production_domain_discovery"});
  }
  const configuredDomains=Array.isArray(input.vercelProject.production_domains)?input.vercelProject.production_domains:[];
  const candidates=productionValidationCandidates({canonicalDomain:seoProject.data?.canonical_domain,projectDomain:seoProject.data?.domain,providerDomains,configuredDomains});
  const syncedDomains=verifiedProviderHostnames(providerDomains).filter(hostname=>!isGeneratedVercelHostname(hostname));
  if(syncedDomains.length){
    const saved=await db.from("vercel_projects").update({production_domains:syncedDomains,last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",input.vercelProject.id).eq("agency_id",input.agencyId);
    if(saved.error)throw new ApiError("The verified production domains could not be synchronized.",500,"DATABASE_BINDING_FAILED");
  }
  if(!candidates.length)throw new ApiError("A public production domain is not ready yet. HD SEO will discover it and retry automatically.",503,"PRODUCTION_VALIDATION_RETRY");
  return candidates;
}

async function recoverProtectedProductionValidations(db:ReturnType<typeof requireAdminDb>){
  const checks=await db.from("deployment_checks").select("deployment_id,details,updated_at").eq("check_type","health").eq("status","failed").order("updated_at",{ascending:false}).limit(50);
  if(checks.error)throw new ApiError("Production validation recovery could not inspect recent health checks.",500,"DATABASE_BINDING_FAILED");
  let recovered=0;
  for(const check of checks.data??[]){
    const details=check.details&&typeof check.details==="object"?check.details as Record<string,unknown>:{};
    if(details.reason!=="vercel_deployment_protection")continue;
    const deployment=await db.from("deployments").select("id,agency_id,project_id,vercel_project_id,git_sha,status,environment,provider_metadata,validation_summary").eq("id",check.deployment_id).eq("environment","production").eq("status","failed").maybeSingle();
    if(!deployment.data?.git_sha)continue;
    const summary=deployment.data.validation_summary&&typeof deployment.data.validation_summary==="object"?deployment.data.validation_summary as Record<string,unknown>:{};
    if(Number(summary.productionTargetRecoveryAttempts??0)>=3)continue;
    const execution=await db.from("seo_executions").select("id,agency_id,client_organization_id,project_id,outcome_run_id,status").eq("merge_commit_sha",deployment.data.git_sha).eq("agency_id",deployment.data.agency_id).maybeSingle();
    if(!execution.data||execution.data.status!=="production_failed")continue;
    const vercelProject=await db.from("vercel_projects").select("id,connection_id,vercel_project_id,production_domains").eq("id",deployment.data.vercel_project_id).eq("agency_id",deployment.data.agency_id).maybeSingle();
    if(!vercelProject.data)continue;
    let targets:ProductionValidationCandidate[];
    try{targets=await loadProductionValidationTargets(db,{agencyId:deployment.data.agency_id,projectId:deployment.data.project_id,vercelProject:vercelProject.data});}
    catch(error){const safe=safeError(error);logEvent("production_validation_recovery_deferred",{executionId:execution.data.id,agencyId:deployment.data.agency_id,projectId:deployment.data.project_id,status:"deferred",errorCode:safe.body.error.code,stage:"production_domain_discovery"});continue;}
    const target=targets[0],now=new Date().toISOString(),providerMetadata=deployment.data.provider_metadata&&typeof deployment.data.provider_metadata==="object"?deployment.data.provider_metadata as Record<string,unknown>:{};
    const results=await Promise.all([
      db.from("deployments").update({status:"ready",provider_metadata:{...providerMetadata,validationBaseUrl:target.baseUrl,validationTargetSource:target.source,validationCandidates:targets},validation_summary:{...summary,productionTargetRecoveryAttempts:Number(summary.productionTargetRecoveryAttempts??0)+1,productionTargetRecoveryReason:"protected_generated_deployment_url",productionTargetRecoveredAt:now},completed_at:null,updated_at:now}).eq("id",deployment.data.id),
      db.from("seo_campaign_jobs").update({status:"awaiting_deployment",current_stage:"production_qa",error_code:null,error_message:null,error_details:{},failed_at:null,completed_at:null,worker_id:null,locked_at:null,lock_expires_at:null,heartbeat_at:null,next_attempt_at:now,updated_at:now}).contains("result",{executionId:execution.data.id}),
      execution.data.outcome_run_id?db.from("outcome_loop_runs").update({status:"publishing",current_step:"publish",failure_code:null,failure_message:null,completed_at:null,updated_at:now}).eq("id",execution.data.outcome_run_id):Promise.resolve({error:null}),
      execution.data.outcome_run_id?db.from("outcome_loop_steps").update({status:"running",completed_at:null,updated_at:now}).eq("run_id",execution.data.outcome_run_id).eq("step_key","publish"):Promise.resolve({error:null}),
      db.from("background_jobs").upsert({queue:"deployments",job_type:"deployment.validate",agency_id:deployment.data.agency_id,deployment_id:deployment.data.id,payload:{source:"production_target_recovery",executionId:execution.data.id},status:"queued",priority:95,available_at:now,attempt_count:0,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,last_error_code:null,last_error_message:null,completed_at:null,idempotency_key:`deployment.validate:${deployment.data.id}`,updated_at:now},{onConflict:"queue,idempotency_key"}),
    ]);
    if(results.some(result=>"error" in result&&result.error))throw new ApiError("The protected production validation could not be restored.",500,"DATABASE_BINDING_FAILED");
    recovered++;
    logEvent("production_validation_recovered",{executionId:execution.data.id,agencyId:deployment.data.agency_id,projectId:deployment.data.project_id,status:"queued",stage:"production_qa"});
  }
  return recovered;
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

async function ensureProductionRollbackBaseline(db:ReturnType<typeof requireAdminDb>,input:{
  deployment:{id:string;agency_id:string;client_id:string;client_organization_id:string;project_id:string;vercel_project_id:string;repository_id:string|null;external_deployment_id:string|null;git_sha:string|null;previous_deployment_id:string|null;validation_summary?:unknown};
  vercelProject:{connection_id:string;vercel_project_id:string;production_branch:string|null};
  currentProvider?:import("@/lib/vercel/client").VercelDeployment|null;
}){
  if(input.deployment.previous_deployment_id)return{ready:true,baselineDeploymentId:input.deployment.previous_deployment_id,repaired:false};
  const credentials=await loadVercelCredentials(input.vercelProject.connection_id,input.deployment.agency_id),provider=await listVercelDeployments(credentials,{projectId:input.vercelProject.vercel_project_id,target:"production",limit:50});
  let current=input.currentProvider??provider.deployments.find(candidate=>candidate.id===input.deployment.external_deployment_id)??null;
  if(!current&&input.deployment.git_sha){
    current=provider.deployments.find(candidate=>(candidate.meta?.githubCommitSha??candidate.meta?.gitCommitSha)===input.deployment.git_sha)??null;
    if(!current){
      for(const candidate of provider.deployments.slice(0,10)){
        const detail=await getVercelDeployment(credentials,candidate.id),sha=detail.meta?.githubCommitSha??detail.meta?.gitCommitSha;
        if(sha===input.deployment.git_sha){current={...candidate,...detail};break;}
      }
    }
  }
  if(!current)return{ready:false,baselineDeploymentId:null,repaired:false,reason:"current_provider_deployment_not_found"};
  if(!input.deployment.external_deployment_id){
    const bound=await db.from("deployments").update({external_deployment_id:current.id,url:current.url,updated_at:new Date().toISOString()}).eq("id",input.deployment.id).eq("agency_id",input.deployment.agency_id);
    if(bound.error)throw new ApiError("The current production deployment could not be bound to its provider record.",500,"DATABASE_BINDING_FAILED");
  }
  const previous=selectPriorProductionDeployment(provider.deployments,current);
  const currentSummary=input.deployment.validation_summary&&typeof input.deployment.validation_summary==="object"?input.deployment.validation_summary as Record<string,unknown>:{};
  if(!previous){
    const metadata={...currentSummary,rollbackReady:false,rollbackReason:"no_prior_provider_production",rollbackCheckedAt:new Date().toISOString()};
    await db.from("deployments").update({validation_summary:metadata,updated_at:new Date().toISOString()}).eq("id",input.deployment.id).eq("agency_id",input.deployment.agency_id);
    return{ready:false,baselineDeploymentId:null,repaired:false,reason:"no_prior_provider_production"};
  }
  let baseline=await db.from("deployments").select("id,external_deployment_id").eq("vercel_project_id",input.deployment.vercel_project_id).eq("external_deployment_id",previous.id).maybeSingle();
  if(baseline.error)throw new ApiError("The rollback baseline could not be inspected.",500,"DATABASE_BINDING_FAILED");
  if(!baseline.data){
    const now=new Date().toISOString(),sha=previous.meta?.githubCommitSha??previous.meta?.gitCommitSha??null,createdAt=providerDeploymentIso(previous.createdAt,now),readyAt=providerDeploymentIso(previous.ready,createdAt);
    baseline=await db.from("deployments").insert({
      agency_id:input.deployment.agency_id,client_id:input.deployment.client_id,client_organization_id:input.deployment.client_organization_id,project_id:input.deployment.project_id,vercel_project_id:input.deployment.vercel_project_id,repository_id:input.deployment.repository_id,external_deployment_id:previous.id,environment:"production",git_ref:input.vercelProject.production_branch??"main",git_sha:sha,url:previous.url,status:"ready",provider_metadata:{provider:previous,source:"production_baseline_import",importedForDeploymentId:input.deployment.id},validation_summary:{baselineImported:true,providerState:"READY",rollbackTargetVerifiedAt:now},started_at:createdAt,ready_at:readyAt,completed_at:readyAt,updated_at:now,
    }).select("id,external_deployment_id").single();
    if(baseline.error||!baseline.data)throw new ApiError("The prior production rollback baseline could not be recorded.",500,"DATABASE_BINDING_FAILED");
  }
  const now=new Date().toISOString(),linked=await db.from("deployments").update({previous_deployment_id:baseline.data.id,validation_summary:{...currentSummary,rollbackReady:true,rollbackBaselineDeploymentId:baseline.data.id,rollbackProviderDeploymentId:previous.id,rollbackCheckedAt:now},updated_at:now}).eq("id",input.deployment.id).eq("agency_id",input.deployment.agency_id);
  if(linked.error)throw new ApiError("The verified rollback baseline could not be linked to this release.",500,"DATABASE_BINDING_FAILED");
  logEvent("production_rollback_baseline_ready",{agencyId:input.deployment.agency_id,projectId:input.deployment.project_id,deploymentId:input.deployment.id,baselineDeploymentId:baseline.data.id,status:"ready",stage:"rollback_readiness"});
  return{ready:true,baselineDeploymentId:baseline.data.id,repaired:true};
}

async function recoverMissingProductionRollbackBaselines(db:ReturnType<typeof requireAdminDb>){
  const deployments=await db.from("deployments").select("id,agency_id,client_id,client_organization_id,project_id,vercel_project_id,repository_id,external_deployment_id,git_sha,previous_deployment_id,validation_summary,updated_at").eq("environment","production").eq("status","healthy").is("previous_deployment_id",null).order("updated_at",{ascending:false}).limit(10);
  if(deployments.error)throw new ApiError("Rollback readiness recovery could not inspect healthy releases.",500,"DATABASE_BINDING_FAILED");
  let inspected=0,repaired=0;const deferred:Array<{deploymentId:string;reason:string}>=[];
  for(const deployment of deployments.data??[]){
    const summary=deployment.validation_summary&&typeof deployment.validation_summary==="object"?deployment.validation_summary as Record<string,unknown>:{},lastChecked=typeof summary.rollbackCheckedAt==="string"?new Date(summary.rollbackCheckedAt).getTime():0;
    if(summary.rollbackReady===false&&Date.now()-lastChecked<86_400_000)continue;
    inspected++;
    try{
      const project=await db.from("vercel_projects").select("connection_id,vercel_project_id,production_branch").eq("id",deployment.vercel_project_id).eq("agency_id",deployment.agency_id).eq("status","active").maybeSingle();
      if(!project.data){deferred.push({deploymentId:deployment.id,reason:"vercel_project_not_active"});continue;}
      const result=await ensureProductionRollbackBaseline(db,{deployment,vercelProject:project.data});
      if(result.repaired)repaired++;else if(!result.ready)deferred.push({deploymentId:deployment.id,reason:result.reason??"baseline_unavailable"});
    }catch(error){const safe=safeError(error);deferred.push({deploymentId:deployment.id,reason:safe.body.error.code});logEvent("production_rollback_baseline_deferred",{agencyId:deployment.agency_id,projectId:deployment.project_id,deploymentId:deployment.id,status:"deferred",errorCode:safe.body.error.code,stage:"rollback_readiness"});}
  }
  return{inspected,repaired,deferred};
}

async function reconcileProductionDeployments(db:ReturnType<typeof requireAdminDb>){
  const recovered=await recoverProtectedProductionValidations(db);
  const healthyOutcomes=await reconcileRecentHealthyProductionOutcomes(db);
  const rollbackBaselines=await recoverMissingProductionRollbackBaselines(db);
  const waitingCampaigns=await db.from("seo_campaign_jobs").select("id,agency_id,client_organization_id,project_id,outcome_run_id,result,status,current_stage").eq("status","awaiting_deployment").order("updated_at",{ascending:true}).limit(20);
  if(waitingCampaigns.error)throw new ApiError("Production deployment reconciliation could not read the waiting campaign queue.",500,"DATABASE_BINDING_FAILED");
  const waitingExecutionIds=[...new Set((waitingCampaigns.data??[]).map(campaign=>campaign.result&&typeof campaign.result==="object"?(campaign.result as Record<string,unknown>).executionId:null).filter((id):id is string=>typeof id==="string"&&Boolean(id)))];
  const campaignExecutions=waitingExecutionIds.length?await db.from("seo_executions").select("id,agency_id,client_organization_id,project_id,repository_connection_id,merge_commit_sha,production_commit_sha,production_deployed_at,status,outcome_run_id,merged_at").in("id",waitingExecutionIds):{data:[],error:null};
  if(campaignExecutions.error)throw new ApiError("Production deployment reconciliation could not read the waiting executions.",500,"DATABASE_BINDING_FAILED");
  const legacyMerged=await db.from("seo_executions").select("id,agency_id,client_organization_id,project_id,repository_connection_id,merge_commit_sha,production_commit_sha,production_deployed_at,status,outcome_run_id,merged_at").eq("status","merged").not("merge_commit_sha","is",null).order("merged_at",{ascending:true}).limit(20);
  if(legacyMerged.error)throw new ApiError("Production deployment reconciliation could not read merged executions.",500,"DATABASE_BINDING_FAILED");
  const pending=[...(campaignExecutions.data??[]),...(legacyMerged.data??[])].filter((execution,index,all)=>all.findIndex(candidate=>candidate.id===execution.id)===index);
  let detected=0,queued=0;const errors:Array<{executionId:string;code:string;message:string}>=[];
  for(const execution of pending){
    try{
      if(execution.production_deployed_at||execution.status==="production_deployed"){
        const now=new Date().toISOString();
        await db.from("seo_campaign_jobs").update({status:"queued",current_stage:"schedule_monitoring",next_attempt_at:now,error_code:null,error_message:null,updated_at:now}).contains("result",{executionId:execution.id}).eq("status","awaiting_deployment");
        logEvent("production_deployment_state_repaired",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"production_deployed",stage:"schedule_monitoring"});
        continue;
      }
      if(!execution.merge_commit_sha){logEvent("production_deployment_reconciliation_waiting",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"waiting",stage:"merge_commit"});continue;}
      const vercelProject=await db.from("vercel_projects").select("id,client_id,repository_id,connection_id,vercel_project_id,production_branch,production_domains").eq("agency_id",execution.agency_id).eq("project_id",execution.project_id).eq("status","active").not("repository_id","is",null).order("updated_at",{ascending:false}).limit(1).maybeSingle();
      if(!vercelProject.data){logEvent("production_deployment_reconciliation_waiting",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"waiting",stage:"vercel_project_mapping"});continue;}
      const credentials=await loadVercelCredentials(vercelProject.data.connection_id,execution.agency_id),provider=await listVercelDeployments(credentials,{projectId:vercelProject.data.vercel_project_id,target:"production",limit:20,since:execution.merged_at?new Date(execution.merged_at).getTime()-300_000:undefined});
      let matched=provider.deployments.find(item=>{
        const sha=item.meta?.githubCommitSha??item.meta?.gitCommitSha;
        return sha===execution.merge_commit_sha;
      });
      if(!matched){
        for(const candidate of provider.deployments.slice(0,5)){
          const detail=await getVercelDeployment(credentials,candidate.id),sha=detail.meta?.githubCommitSha??detail.meta?.gitCommitSha;
          if(sha===execution.merge_commit_sha){matched={...candidate,...detail};break;}
        }
      }
      if(!matched){logEvent("production_deployment_reconciliation_waiting",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"waiting",stage:"provider_deployment_match"});continue;}
      const state=(matched.readyState??"").toUpperCase();
      if(state==="ERROR"||state==="CANCELED"){
        const now=new Date().toISOString(),message="Vercel reported that the production deployment failed. The previous live version remains protected.";
        await Promise.all([
          db.from("seo_executions").update({status:"production_failed",updated_at:now}).eq("id",execution.id),
          db.from("seo_campaign_jobs").update({status:"failed",error_code:"VERCEL_DEPLOYMENT_FAILED",error_message:message,failed_at:now,updated_at:now}).contains("result",{executionId:execution.id}),
          execution.outcome_run_id?db.from("outcome_loop_runs").update({status:"failed",failure_code:"VERCEL_DEPLOYMENT_FAILED",failure_message:message,completed_at:now,updated_at:now}).eq("id",execution.outcome_run_id):Promise.resolve({error:null}),
        ]);
        continue;
      }
      if(state!=="READY")continue;
      detected++;
      const validationTargets=await loadProductionValidationTargets(db,{agencyId:execution.agency_id,projectId:execution.project_id,vercelProject:vercelProject.data,credentials}),validationTarget=validationTargets[0];
      let existing=await db.from("deployments").select("id,agency_id,client_id,client_organization_id,project_id,vercel_project_id,repository_id,external_deployment_id,git_sha,previous_deployment_id,status,provider_metadata,validation_summary").eq("vercel_project_id",vercelProject.data.id).eq("external_deployment_id",matched.id).maybeSingle();
      if(!existing.data)existing=await db.from("deployments").select("id,agency_id,client_id,client_organization_id,project_id,vercel_project_id,repository_id,external_deployment_id,git_sha,previous_deployment_id,status,provider_metadata,validation_summary").eq("vercel_project_id",vercelProject.data.id).eq("environment","production").eq("git_sha",execution.merge_commit_sha).order("updated_at",{ascending:false}).limit(1).maybeSingle();
      if(existing.data){
        await ensureProductionRollbackBaseline(db,{deployment:existing.data,vercelProject:vercelProject.data,currentProvider:matched});
        if(existing.data.status==="healthy"){
          const now=new Date().toISOString();
          await Promise.all([
            db.from("seo_executions").update({status:"production_deployed",production_commit_sha:execution.merge_commit_sha,production_deployed_at:now,updated_at:now}).eq("id",execution.id),
            db.from("seo_campaign_jobs").update({status:"queued",current_stage:"schedule_monitoring",next_attempt_at:now,error_code:null,error_message:null,updated_at:now}).contains("result",{executionId:execution.id}),
          ]);
          if(execution.outcome_run_id)await reconcileHealthyProductionOutcome(db,{outcomeRunId:execution.outcome_run_id,executionId:execution.id,deploymentId:existing.data.id});
          logEvent("production_deployment_state_repaired",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"production_deployed",stage:"schedule_monitoring"});
        }
        if(existing.data.status==="ready"){
          const existingMetadata=existing.data.provider_metadata&&typeof existing.data.provider_metadata==="object"?existing.data.provider_metadata as Record<string,unknown>:{};
          await db.from("deployments").update({external_deployment_id:matched.id,url:matched.url,provider_metadata:{...existingMetadata,provider:matched,source:"production_poll",executionId:execution.id,validationBaseUrl:validationTarget.baseUrl,validationTargetSource:validationTarget.source,validationCandidates:validationTargets},ready_at:matched.ready?new Date(matched.ready).toISOString():new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",existing.data.id);
          const job=await db.from("background_jobs").upsert({queue:"deployments",job_type:"deployment.validate",agency_id:execution.agency_id,deployment_id:existing.data.id,payload:{source:"production_poll",executionId:execution.id},status:"queued",priority:90,available_at:new Date().toISOString(),worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,last_error_code:null,last_error_message:null,completed_at:null,idempotency_key:`deployment.validate:${existing.data.id}`,updated_at:new Date().toISOString()},{onConflict:"queue,idempotency_key"});
          if(job.error)throw new ApiError("Production safety validation could not be restored.",500,"DATABASE_BINDING_FAILED");
          queued++;
        }
        continue;
      }
      const now=new Date().toISOString(),created=await db.from("deployments").insert({
        agency_id:execution.agency_id,client_id:vercelProject.data.client_id,client_organization_id:execution.client_organization_id,project_id:execution.project_id,vercel_project_id:vercelProject.data.id,repository_id:vercelProject.data.repository_id,outcome_run_id:execution.outcome_run_id,external_deployment_id:matched.id,environment:"production",git_ref:vercelProject.data.production_branch??"main",git_sha:execution.merge_commit_sha,url:matched.url,status:"ready",provider_metadata:{provider:matched,source:"production_poll",executionId:execution.id,validationBaseUrl:validationTarget.baseUrl,validationTargetSource:validationTarget.source,validationCandidates:validationTargets},started_at:providerDeploymentIso(matched.createdAt,now),ready_at:providerDeploymentIso(matched.ready,now),updated_at:now,
      }).select("id,agency_id,client_id,client_organization_id,project_id,vercel_project_id,repository_id,external_deployment_id,git_sha,previous_deployment_id,validation_summary").single();
      if(created.error||!created.data)throw new ApiError("The detected production deployment could not be recorded.",500,"DATABASE_BINDING_FAILED");
      await ensureProductionRollbackBaseline(db,{deployment:created.data,vercelProject:vercelProject.data,currentProvider:matched});
      const job=await db.from("background_jobs").upsert({queue:"deployments",job_type:"deployment.validate",agency_id:execution.agency_id,deployment_id:created.data.id,payload:{source:"production_poll",executionId:execution.id},status:"queued",priority:90,idempotency_key:`deployment.validate:${created.data.id}`},{onConflict:"queue,idempotency_key",ignoreDuplicates:true});
      if(job.error)throw new ApiError("Production safety validation could not be queued.",500,"DATABASE_BINDING_FAILED");
      queued++;
      logEvent("production_deployment_reconciled",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"queued",stage:"production_qa"});
    }catch(error){
      const safe=safeError(error);errors.push({executionId:execution.id,code:safe.body.error.code,message:safe.body.error.message});
      logEvent("production_deployment_reconciliation_failed",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"deferred",errorCode:safe.body.error.code,stage:"production_poll"});
    }
  }
  return{recovered,healthyOutcomes,rollbackBaselines,detected,queued,errors};
}

async function reconcilePreviewCampaigns(db:ReturnType<typeof requireAdminDb>){
  const strandedPreviews=await db.from("seo_executions").select("id,agency_id,client_organization_id,project_id,outcome_run_id,preview_deployment_id,validation_results").eq("status","preview_queued").not("preview_deployment_id","is",null).order("updated_at",{ascending:true}).limit(20);
  if(strandedPreviews.error)throw new ApiError("Preview reconciliation could not read pending executions.",500,"DATABASE_BINDING_FAILED");
  let previewJobsRecovered=0;
  for(const execution of strandedPreviews.data??[]){
    const deployment=await db.from("deployments").select("id,agency_id,automation_run_id,status,external_deployment_id,validation_summary").eq("id",execution.preview_deployment_id).eq("environment","preview").maybeSingle();
    if(deployment.error)throw new ApiError("Preview reconciliation could not read the deployment.",500,"DATABASE_BINDING_FAILED");
    if(!deployment.data||!["building","ready"].includes(deployment.data.status)||!deployment.data.external_deployment_id)continue;
    const jobType=deployment.data.status==="ready"?"deployment.validate":"deployment.poll",idempotencyKey=`${jobType}:${deployment.data.id}`,existing=await db.from("background_jobs").select("id,status,lock_expires_at,available_at,attempt_count,max_attempts,updated_at,last_error_code,last_error_message").eq("queue","deployments").eq("idempotency_key",idempotencyKey).maybeSingle();
    if(existing.error)throw new ApiError("Preview reconciliation could not inspect the worker job.",500,"DATABASE_BINDING_FAILED");
    const active=previewContinuationJobIsActive(existing.data as PreviewContinuationJobState|null);
    if(active)continue;
    const summary=(deployment.data.validation_summary&&typeof deployment.data.validation_summary==="object"?deployment.data.validation_summary:{}) as Record<string,unknown>,attempts=Number(summary.previewReconciliationAttempts??0);
    if(attempts>=3){
      const now=new Date().toISOString(),failureCode="PREVIEW_CONTINUATION_EXHAUSTED",failureMessage="HD SEO could not complete the preview safety checks after automatic retries. Nothing was published, the previous live website remains unchanged, and support has been alerted.";
      await Promise.all([
        db.from("seo_executions").update({status:"preview_failed",validation_results:{...(execution.validation_results&&typeof execution.validation_results==="object"?execution.validation_results:{}),continuationFailure:{code:failureCode,message:failureMessage,failedAt:now,lastWorkerErrorCode:existing.data?.last_error_code??null,lastWorkerErrorMessage:existing.data?.last_error_message??null}},updated_at:now}).eq("id",execution.id).eq("status","preview_queued"),
        db.from("deployments").update({status:"failed",validation_summary:{...summary,previewContinuationFailure:{code:failureCode,message:failureMessage,failedAt:now}},completed_at:now,updated_at:now}).eq("id",deployment.data.id),
        db.from("seo_campaign_jobs").update({status:"failed",error_code:failureCode,error_message:failureMessage,failed_at:now,worker_id:null,locked_at:null,lock_expires_at:null,heartbeat_at:null,updated_at:now}).contains("result",{executionId:execution.id}),
        execution.outcome_run_id?db.from("outcome_loop_runs").update({status:"failed",failure_code:failureCode,failure_message:failureMessage,completed_at:now,updated_at:now}).eq("id",execution.outcome_run_id):Promise.resolve({error:null}),
        db.from("notifications").insert({agency_id:execution.agency_id,client_organization_id:execution.client_organization_id,project_id:execution.project_id,event_type:"seo.preview_continuation_exhausted",title:"Preview safety checks need attention",body:failureMessage,status:"sent",sent_at:now,client_visible:true,metadata:{executionId:execution.id,deploymentId:deployment.data.id,code:failureCode}}),
      ]);
      logEvent("preview_continuation_exhausted",{executionId:execution.id,agencyId:execution.agency_id,projectId:execution.project_id,status:"failed",errorCode:failureCode,stage:jobType});
      continue;
    }
    const now=new Date().toISOString(),requeued=await db.from("background_jobs").upsert({queue:"deployments",job_type:jobType,agency_id:deployment.data.agency_id,automation_run_id:deployment.data.automation_run_id,deployment_id:deployment.data.id,payload:{source:"preview_reconciliation",executionId:execution.id},status:"queued",priority:90,available_at:now,attempt_count:0,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,last_error_code:null,last_error_message:null,completed_at:null,idempotency_key:idempotencyKey,updated_at:now},{onConflict:"queue,idempotency_key"});
    if(requeued.error)throw new ApiError("Preview continuation could not be restored.",500,"DATABASE_BINDING_FAILED");
    await db.from("deployments").update({validation_summary:{...summary,previewReconciliationAttempts:attempts+1,previewReconciledAt:now},updated_at:now}).eq("id",deployment.data.id);
    previewJobsRecovered++;
    logEvent("preview_continuation_recovered",{executionId:execution.id,agencyId:execution.agency_id,status:"queued",stage:jobType});
  }
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
  const production=await reconcileProductionDeployments(db);
  return{previewJobsRecovered,recovered,policyRecovered,advanced,autopilotReleased,releaseErrors,production};
}

async function createDeployment(job:BackgroundJob){if(!job.deployment_id)throw new ApiError("Deployment job is incomplete.",500,"OPERATION_FAILED");const{db,deployment,project,repository}=await deploymentContext(job.deployment_id);if(!repository)throw new ApiError("Repository record not found.",404,"NOT_FOUND");const safety=safetyMetadata(job,deployment);await claimStoredMutationIntent(db,{intentId:safety.mutationIntentId,agencyId:job.agency_id,projectId:deployment.project_id,toolKey:"vercel.deploy",expectedDigest:safety.actionDigest,executionRef:job.id});const credentials=await loadVercelCredentials(project.connection_id,job.agency_id),now=new Date().toISOString();await db.from("deployments").update({status:"creating",started_at:now,updated_at:now}).eq("id",deployment.id);await setRun(job.automation_run_id,"running","deployment.create");const created=await createVercelDeployment(credentials,{projectId:project.vercel_project_id,projectName:project.name,repositoryId:String(repository.github_repository_id),ref:deployment.git_ref,sha:deployment.git_sha??undefined,environment:deployment.environment,metadata:{hdSeoDeploymentId:deployment.id,hdSeoRunId:job.automation_run_id??"",githubCommitSha:deployment.git_sha??"",projectId:project.vercel_project_id,hdSeoMutationIntentId:safety.mutationIntentId,hdSeoActionDigest:safety.actionDigest}});const saved=await db.from("deployments").update({external_deployment_id:created.id,url:created.url,status:created.readyState==="READY"?"ready":"building",provider_metadata:{...created,safety},updated_at:new Date().toISOString()}).eq("id",deployment.id);if(saved.error)throw new ApiError("The Vercel deployment succeeded but reconciliation must complete before retrying.",503,"DATABASE_BINDING_FAILED");await settleMutationIntent(db,{intentId:safety.mutationIntentId,executionRef:job.id,status:"succeeded"});await addLog(deployment.id,"vercel","info","Vercel deployment created.",{providerDeploymentId:created.id,url:created.url});await db.from("background_jobs").upsert({queue:"deployments",job_type:created.readyState==="READY"?"deployment.validate":"deployment.poll",agency_id:job.agency_id,automation_run_id:job.automation_run_id,deployment_id:deployment.id,payload:{},status:"queued",priority:created.readyState==="READY"?80:60,available_at:new Date(Date.now()+(created.readyState==="READY"?0:20_000)).toISOString(),idempotency_key:`${created.readyState==="READY"?"deployment.validate":"deployment.poll"}:${deployment.id}`},{onConflict:"queue,idempotency_key",ignoreDuplicates:true});}

async function pollDeployment(job:BackgroundJob){if(!job.deployment_id)throw new ApiError("Poll job is incomplete.",500,"OPERATION_FAILED");const{db,deployment,project}=await deploymentContext(job.deployment_id);if(!deployment.external_deployment_id)throw new ApiError("Vercel deployment ID is not available yet.",503,"OPERATION_FAILED");const credentials=await loadVercelCredentials(project.connection_id,job.agency_id),provider=await getVercelDeployment(credentials,deployment.external_deployment_id),state=(provider.readyState??"").toUpperCase(),previousMetadata=deployment.provider_metadata&&typeof deployment.provider_metadata==="object"?deployment.provider_metadata:{};await db.from("deployments").update({status:state==="READY"?"ready":state==="ERROR"?"failed":"building",url:provider.url??deployment.url,ready_at:state==="READY"?new Date().toISOString():null,completed_at:state==="ERROR"?new Date().toISOString():null,provider_metadata:{...previousMetadata,provider},updated_at:new Date().toISOString()}).eq("id",deployment.id);if(!terminalStates.has(state))throw new ApiError("Vercel deployment is still building.",503,"OPERATION_FAILED");try{const events=await getVercelDeploymentEvents(credentials,deployment.external_deployment_id);for(const [index,event] of events.entries())await db.from("deploy_logs").upsert({deployment_id:deployment.id,sequence:event.date??event.created??index,source:"vercel",level:event.type==="stderr"?"error":"info",message:(event.text??event.type??"Vercel event").slice(0,10_000),metadata:event},{onConflict:"deployment_id,source,sequence",ignoreDuplicates:true})}catch{await addLog(deployment.id,"vercel","warn","Deployment completed, but build logs could not be collected.")};if(state==="ERROR"){await setRun(job.automation_run_id,"failed","deployment.failed",{code:"VERCEL_DEPLOYMENT_FAILED",message:"Vercel reported a failed deployment."});return}await db.from("background_jobs").upsert({queue:"deployments",job_type:"deployment.validate",agency_id:job.agency_id,automation_run_id:job.automation_run_id,deployment_id:deployment.id,payload:{},status:"queued",priority:80,idempotency_key:`deployment.validate:${deployment.id}`},{onConflict:"queue,idempotency_key",ignoreDuplicates:true});}

async function validateDeployment(job:BackgroundJob){
  if(!job.deployment_id)throw new ApiError("Validation job is incomplete.",500,"OPERATION_FAILED");
  const{db,deployment,project}=await deploymentContext(job.deployment_id);
  if(!deployment.url)throw new ApiError("Deployment URL is not available.",503,"OPERATION_FAILED");
  const executionQuery=db.from("seo_executions").select("id,validation_results,outcome_run_id,opportunity_id,client_organization_id");
  const executionContext=deployment.environment==="production"&&deployment.git_sha
    ?await executionQuery.eq("merge_commit_sha",deployment.git_sha).maybeSingle()
    :await executionQuery.eq("preview_deployment_id",deployment.id).maybeSingle();
  const opportunity=executionContext.data?.opportunity_id?await db.from("seo_opportunities").select("target_url").eq("id",executionContext.data.opportunity_id).maybeSingle():{data:null};
  let targetPath="/";
  if(opportunity.data?.target_url)try{targetPath=new URL(opportunity.data.target_url,"https://hdseo.invalid").pathname;}catch{throw new ApiError("The approved SEO target URL is invalid.",409,"VALIDATION_ERROR");}
  const providerMetadata=deployment.provider_metadata&&typeof deployment.provider_metadata==="object"?deployment.provider_metadata as Record<string,unknown>:{};
  const validationTargets=deployment.environment==="production"
    ?await loadProductionValidationTargets(db,{agencyId:job.agency_id,projectId:deployment.project_id,vercelProject:{id:project.id,connection_id:project.connection_id,vercel_project_id:project.vercel_project_id,production_domains:project.production_domains}})
    :[{baseUrl:deployment.url.startsWith("http")?deployment.url:`https://${deployment.url}`,hostname:new URL(deployment.url.startsWith("http")?deployment.url:`https://${deployment.url}`).hostname,source:"configured_domain" as const}];
  let validationTarget=validationTargets[0],validationUrl=new URL(targetPath,validationTarget.baseUrl).toString();
  const previous=deployment.previous_deployment_id
    ?await db.from("deployments").select("id").eq("id",deployment.previous_deployment_id).in("status",["ready","healthy","rolled_back"]).maybeSingle()
    :await db.from("deployments").select("id").eq("vercel_project_id",deployment.vercel_project_id).eq("environment",deployment.environment).eq("status","healthy").neq("id",deployment.id).order("completed_at",{ascending:false}).limit(1).maybeSingle();
  const baselineChecks=previous.data?await db.from("deployment_checks").select("check_type,score,details").eq("deployment_id",previous.data.id):{data:[]};
  const baseline=previous.data?deploymentSnapshotFromChecks(baselineChecks.data??[]):null;
  await db.from("deployments").update({status:"validating",updated_at:new Date().toISOString()}).eq("id",deployment.id);
  await setRun(job.automation_run_id,"running","deployment.validate");
  const started=new Date().toISOString();
  let checks:ValidationCheck[];
  if(deployment.environment==="preview"){
    const credentials=await loadVercelCredentials(project.connection_id,job.agency_id);
    let bypass=await ensureVercelAutomationBypass({credentials,projectId:project.vercel_project_id,environmentConfig:project.environment_config});
    if(bypass.created)await saveBypassConfig(db,project.id,job.agency_id,bypass.environmentConfig);
    checks=await validateDeploymentUrl(validationUrl,{protectionBypassSecret:bypass.secret,environment:deployment.environment});
    if(protectionRedirect(checks)){
      bypass=await ensureVercelAutomationBypass({credentials,projectId:project.vercel_project_id,environmentConfig:bypass.environmentConfig,forceRefresh:true});
      await saveBypassConfig(db,project.id,job.agency_id,bypass.environmentConfig);
      await addLog(deployment.id,"hdseo","warn","Vercel preview access expired; HD SEO rotated it and retried validation.",{reason:"protection_bypass_rotation"});
      checks=await validateDeploymentUrl(validationUrl,{protectionBypassSecret:bypass.secret,environment:deployment.environment});
    }
  }else{
    checks=[];
    for(const [index,target] of validationTargets.entries()){
      validationTarget=target;
      validationUrl=new URL(targetPath,target.baseUrl).toString();
      checks=await validateDeploymentUrl(validationUrl,{environment:deployment.environment});
      if(!protectionRedirect(checks))break;
      await addLog(deployment.id,"hdseo","warn","A protected Vercel hostname was excluded from production QA; HD SEO is trying the verified public domain.",{validationTarget:target.hostname,validationTargetSource:target.source});
      if(index===validationTargets.length-1){
        const previousSummary=deployment.validation_summary&&typeof deployment.validation_summary==="object"?deployment.validation_summary as Record<string,unknown>:{};
        await db.from("deployments").update({status:"ready",validation_summary:{...previousSummary,retrying:true,reason:"production_domain_protected",lastTransientFailureAt:new Date().toISOString()},completed_at:null,updated_at:new Date().toISOString()}).eq("id",deployment.id);
        throw new ApiError("The public production domain is still protected. HD SEO will retry automatically without treating the website as failed.",503,"PRODUCTION_VALIDATION_RETRY");
      }
    }
    await db.from("deployments").update({provider_metadata:{...providerMetadata,validationBaseUrl:validationTarget.baseUrl,validationTargetSource:validationTarget.source,validationCandidates:validationTargets},updated_at:new Date().toISOString()}).eq("id",deployment.id);
  }
  if(deployment.environment==="preview"&&transientPreviewFailure(checks)){
    const health=checks.find(check=>check.checkType==="health");
    const previousSummary=deployment.validation_summary&&typeof deployment.validation_summary==="object"?deployment.validation_summary as Record<string,unknown>:{};
    await db.from("deployments").update({status:"ready",validation_summary:{...previousSummary,retrying:true,reason:"temporary_preview_access",health:health?.details??{},lastTransientFailureAt:new Date().toISOString()},completed_at:null,updated_at:new Date().toISOString()}).eq("id",deployment.id);
    throw new ApiError("The preview is temporarily unavailable. HD SEO will retry automatically.",503,"PREVIEW_VALIDATION_RETRY");
  }
  const current=deploymentSnapshotFromChecks(checks),drift=compareSeoDrift(baseline,current);
  checks.push({checkType:"drift",status:drift.status,required:drift.required,details:{baselineDeploymentId:previous.data?.id??null,findings:drift.findings,baseline:drift.baseline,current:drift.current}});
  for(const check of checks){const saved=await db.from("deployment_checks").upsert({deployment_id:deployment.id,check_type:check.checkType,status:check.status,required:check.required,score:check.score??null,details:check.details,started_at:started,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"deployment_id,check_type"});if(saved.error)throw new ApiError(`The ${check.checkType} validation result could not be persisted.`,500,"DATABASE_BINDING_FAILED");}
  const failed=checks.filter(check=>check.required&&check.status==="failed"),priorSummary=deployment.validation_summary&&typeof deployment.validation_summary==="object"?deployment.validation_summary as Record<string,unknown>:{},summary={...priorSummary,retrying:false,passed:checks.filter(c=>c.status==="passed").length,warnings:checks.filter(c=>c.status==="warning").length,failed:failed.map(c=>c.checkType),checks:checks.length,baselineDeploymentId:previous.data?.id??null,validationModelVersion:deployment.environment==="preview"?"preview-aware-v2":"production-aware-v2",validatedUrl:validationUrl,validationTargetSource:validationTarget.source};
  await db.from("deployments").update({status:failed.length?"failed":"healthy",validation_summary:summary,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",deployment.id);
  const client=await db.from("clients").select("organization_id,automation_config").eq("id",deployment.client_id).single(),run=job.automation_run_id?await db.from("automation_runs").select("seo_job_id").eq("id",job.automation_run_id).single():null,seoJob=run?.data?await db.from("seo_jobs").select("requested_by").eq("id",run.data.seo_job_id).single():null;
  const execution=executionContext;
  if(execution.data){
    const now=new Date().toISOString();
    if(deployment.environment==="production"){
      const failureMessage=`The production deployment failed required checks: ${failed.map(item=>item.checkType).join(", ")}. HD SEO kept the previous safe version available for rollback.`;
      await db.from("seo_executions").update({status:failed.length?"production_failed":"production_deployed",production_commit_sha:deployment.git_sha,production_deployed_at:failed.length?null:now,validation_results:{...(execution.data.validation_results??{}),production:{status:failed.length?"failed":"healthy",deploymentId:deployment.id,url:validationUrl,summary,checks}},updated_at:now}).eq("id",execution.data.id);
      if(failed.length){
        await db.from("seo_campaign_jobs").update({status:"failed",error_code:"PRODUCTION_QA_FAILED",error_message:failureMessage,failed_at:now,updated_at:now}).contains("result",{executionId:execution.data.id});
        if(execution.data.outcome_run_id)await db.from("outcome_loop_runs").update({status:"failed",failure_code:"PRODUCTION_QA_FAILED",failure_message:failureMessage,completed_at:now,updated_at:now}).eq("id",execution.data.outcome_run_id);
      }else{
        await db.from("seo_campaign_jobs").update({status:"queued",current_stage:"schedule_monitoring",next_attempt_at:now,error_code:null,error_message:null,updated_at:now}).contains("result",{executionId:execution.data.id});
        if(execution.data.outcome_run_id)await reconcileHealthyProductionOutcome(db,{outcomeRunId:execution.data.outcome_run_id,executionId:execution.data.id,deploymentId:deployment.id});
        logEvent("production_deployed",{executionId:execution.data.id,agencyId:deployment.agency_id,projectId:deployment.project_id,status:"production_deployed",stage:"production_qa"});
      }
      await db.from("notifications").insert({agency_id:deployment.agency_id,client_organization_id:client.data?.organization_id??null,project_id:deployment.project_id,user_id:seoJob?.data?.requested_by??null,event_type:failed.length?"seo.production_failed":"seo.production_healthy",title:failed.length?"Production change needs rollback":"SEO change published safely",body:failed.length?failureMessage:"The approved change is live, passed production safety checks, and is now being monitored for rankings, traffic, leads, and value.",status:"sent",sent_at:now,client_visible:true,metadata:{executionId:execution.data.id,deploymentId:deployment.id,url:validationUrl,summary}});
    }else{
      await db.from("seo_executions").update({status:failed.length?"preview_failed":"preview_ready",preview_url:deployment.url,preview_validated_at:now,validation_results:{...(execution.data.validation_results??{}),preview:{status:failed.length?"failed":"healthy",deploymentId:deployment.id,url:deployment.url,summary,checks}}}).eq("id",execution.data.id);
      await reconcileCampaignForExecution(db,execution.data.id,execution.data.outcome_run_id,failed.length?"failed":"ready",failed.length?`The preview failed required checks: ${failed.map(item=>item.checkType).join(", ")}. Nothing was published.`:undefined);
      if(!failed.length&&execution.data.outcome_run_id)await releaseAutopilotPreview(db,{executionId:execution.data.id,agencyId:deployment.agency_id,clientId:execution.data.client_organization_id,projectId:deployment.project_id});
      const clientVisibleBody=failed.length?`The preview failed required checks: ${failed.map(item=>item.checkType).join(", ")}. Nothing was published.`:"The preview passed all required checks. Autopilot will continue the unchanged approved work automatically.";
      await db.from("notifications").insert({agency_id:deployment.agency_id,client_organization_id:client.data?.organization_id??null,project_id:deployment.project_id,user_id:seoJob?.data?.requested_by??null,event_type:failed.length?"seo.preview_failed":"seo.preview_ready",title:failed.length?"SEO preview needs revision":"SEO preview passed safety checks",body:clientVisibleBody,status:"sent",sent_at:now,client_visible:true,metadata:{executionId:execution.data.id,deploymentId:deployment.id,url:deployment.url,summary}});
    }
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
export async function processDeploymentBatch(size=env.AUTOMATION_JOB_BATCH_SIZE,workerId=`automation:${crypto.randomUUID()}`){const db=requireAdminDb(),reconciliation=await reconcilePreviewCampaigns(db),claimed=await db.rpc("claim_background_jobs",{p_worker_id:workerId,p_batch_size:size,p_lock_seconds:300,p_queue:"deployments"});if(claimed.error)throw new Error("Background jobs could not be claimed.");const jobs=(claimed.data??[]) as BackgroundJob[],results=[];for(const job of jobs){const handler=handlers[job.job_type];try{if(!handler)throw new ApiError(`Unknown background job type: ${job.job_type}`,500,"OPERATION_FAILED");if(!job.fencing_token)throw new ApiError("The claimed deployment job has no fencing token.",500,"INVALID_STATE");const lease=await db.rpc("extend_background_job_lease",{p_job_id:job.id,p_worker_id:workerId,p_fencing_token:job.fencing_token,p_lock_seconds:300});if(lease.error||!lease.data)throw new ApiError("The deployment worker lost its job lease.",409,"CONFLICT");await handler(job);const completed=await db.from("background_jobs").update({status:"succeeded",completed_at:new Date().toISOString(),worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token).select("id").maybeSingle();if(!completed.data){results.push({jobId:job.id,status:"stale_worker"});continue;}results.push({jobId:job.id,status:"succeeded"});logEvent("automation_job_completed",{jobId:job.id,agencyId:job.agency_id,status:"succeeded",stage:job.job_type})}catch(error){const safe=safeError(error),retryable=(safe.status===429||safe.status>=500)&&job.attempt_count<job.max_attempts,delay=Math.min(900_000,15_000*2**Math.max(0,job.attempt_count-1))+Math.floor(Math.random()*5000),status=retryable?"retry_scheduled":job.attempt_count>=job.max_attempts?"dead_letter":"failed";await db.from("background_jobs").update({status,available_at:new Date(Date.now()+delay).toISOString(),last_error_code:safe.body.error.code,last_error_message:safe.body.error.message,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token);if(!retryable){if(safe.body.error.code!=="DATABASE_BINDING_FAILED")await failClaimedMutation(db,job,safe.body.error.code,safe.body.error.message);await setRun(job.automation_run_id,"failed",job.job_type,{code:safe.body.error.code,message:safe.body.error.message});if(job.job_type==="deployment.validate"&&job.deployment_id){const deployment=await db.from("deployments").select("environment,git_sha").eq("id",job.deployment_id).maybeSingle(),execution=deployment.data?.environment==="production"&&deployment.data.git_sha?await db.from("seo_executions").select("id,outcome_run_id").eq("merge_commit_sha",deployment.data.git_sha).maybeSingle():await db.from("seo_executions").select("id,outcome_run_id").eq("preview_deployment_id",job.deployment_id).maybeSingle();if(execution.data){if(deployment.data?.environment==="production"){const now=new Date().toISOString();await db.from("seo_campaign_jobs").update({status:"failed",error_code:safe.body.error.code,error_message:safe.body.error.message,failed_at:now,updated_at:now}).contains("result",{executionId:execution.data.id});if(execution.data.outcome_run_id)await db.from("outcome_loop_runs").update({status:"failed",failure_code:safe.body.error.code,failure_message:safe.body.error.message,completed_at:now,updated_at:now}).eq("id",execution.data.outcome_run_id);}else await reconcileCampaignForExecution(db,execution.data.id,execution.data.outcome_run_id,"failed",safe.body.error.message);}}}results.push({jobId:job.id,status,error:safe.body.error});logEvent("automation_job_failed",{jobId:job.id,agencyId:job.agency_id,status,errorCode:safe.body.error.code,stage:job.job_type})}}return{reconciliation,claimed:jobs.length,results}}
