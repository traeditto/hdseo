import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { buildManualPackage } from "@/lib/seo/manual-package";
import { selectImplementationPath,type ImplementationPath } from "@/lib/seo/implementation-path";

export async function createManualPackage(db:SupabaseClient,input:{agencyId:string;clientId:string;projectId:string;opportunityId:string;draftId?:string|null;createdBy:string;requestedPath?:ImplementationPath}){
  const opportunity=await db.from("seo_opportunities").select("id,action_type,target_url,evidence,recommended_actions,confidence_score").eq("id",input.opportunityId).eq("agency_id",input.agencyId).eq("client_organization_id",input.clientId).eq("project_id",input.projectId).single();
  if(!opportunity.data)throw new ApiError("Opportunity not found.",404,"NOT_FOUND");
  const [cms,evidence,deps,page]=await Promise.all([
    db.from("cms_connections").select("cms_type,editor_mode").eq("project_id",input.projectId).order("last_verified_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("business_evidence").select("evidence_type,title,approved_wording,value").eq("project_id",input.projectId).eq("approval_status","approved").or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).limit(100),
    db.from("opportunity_dependencies").select("dependency_type,status,details").eq("opportunity_id",input.opportunityId).neq("status","resolved"),
    db.from("seo_page_snapshots").select("title,meta_description,h1").eq("project_id",input.projectId).eq("url",opportunity.data.target_url??"").order("captured_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  const stored=opportunity.data.evidence as Record<string,unknown>,keyword=typeof stored?.keyword==="string"?stored.keyword:"";if(!keyword)throw new ApiError("A stored ranking keyword is required.",409,"CONFLICT");
  const pathDecision=selectImplementationPath({cmsType:cms.data?.cms_type,actionType:opportunity.data.action_type,repositoryRequested:input.requestedPath==="repository",repositoryReady:false});
  const path=(input.requestedPath&&input.requestedPath!=="repository"?input.requestedPath:pathDecision.path) as Exclude<ImplementationPath,"repository">;
  const verified=(evidence.data??[]).filter(row=>row.approved_wording||row.value).map(row=>({type:row.evidence_type,title:row.title,wording:String(row.approved_wording??row.value)}));
  const missing=Array.isArray(stored?.missingEvidence)?stored.missingEvidence.map(String):[];
  const packageData=buildManualPackage({path,cmsMode:cms.data?.editor_mode,keyword,targetUrl:opportunity.data.target_url,actionType:opportunity.data.action_type,title:page.data?.title,metaDescription:page.data?.meta_description,h1:page.data?.h1,verifiedEvidence:verified,missingEvidence:missing});
  const created=await db.from("implementation_packages").insert({agency_id:input.agencyId,client_organization_id:input.clientId,project_id:input.projectId,opportunity_id:input.opportunityId,action_draft_id:input.draftId??null,implementation_path:path,cms_mode:cms.data?.editor_mode??null,status:"awaiting_agency_review",risk_level:pathDecision.risk,estimated_effort:pathDecision.risk==="high"?"large":pathDecision.risk==="medium"?"medium":"small",hypothesis:`If the approved ${opportunity.data.action_type.toLowerCase()} package is implemented and verified, ranking movement can be evaluated without claiming causation.`,current_state:page.data??{},proposed_state:{metadata:packageData.metadata},package_data:packageData,required_evidence:missing,dependencies:deps.data??[],acceptance_criteria:packageData.acceptanceCriteria,verification_checklist:packageData.verificationChecklist,created_by:input.createdBy}).select("id,status,implementation_path").single();
  if(!created.data)throw new ApiError("Implementation package could not be created.",500,"OPERATION_FAILED");
  const task=await db.from("seo_tasks").insert({agency_id:input.agencyId,client_organization_id:input.clientId,project_id:input.projectId,draft_id:input.draftId??null,title:`Implement ${keyword}`,status:"awaiting_review",priority:opportunity.data.confidence_score>=80?"high":"medium",created_by:input.createdBy,client_visible_notes:"A reviewable implementation package is being prepared."}).select("id").single();
  if(task.data)await db.from("seo_task_approvals").insert({agency_id:input.agencyId,client_organization_id:input.clientId,project_id:input.projectId,task_id:task.data.id,approval_type:"agency",status:"awaiting",requested_by:input.createdBy});
  await db.from("proof_of_work_events").insert({agency_id:input.agencyId,client_organization_id:input.clientId,project_id:input.projectId,opportunity_id:input.opportunityId,package_id:created.data.id,task_id:task.data?.id??null,event_type:"implementation_package_created",title:"Implementation package created",description:`${created.data.implementation_path} package prepared for human review.`,actor_user_id:input.createdBy});
  return{...created.data,taskId:task.data?.id??null};
}
