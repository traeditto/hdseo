import "server-only";
/* Supabase's generated client cannot type tables until migration 0018 has been applied and types regenerated. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type{SupabaseClient}from "@supabase/supabase-js";
import{ApiError}from "@/lib/api/errors";
import{generateEvidenceConstrainedCreative}from "@/lib/creatives/openai";
import{calculateBusinessValue}from "@/lib/seo/business-value";

export type CreativeTenant={agencyId:string;clientId:string;projectId:string;userId:string|null};
export type CampaignCreativeHandoff=
  |{state:"approved";specId:string;draftId:string}
  |{state:"review_required";specId:string;draftId:string}
  |{state:"evidence_required";specId:string;draftId?:string;reason:string}
  |{state:"revision_required";specId:string;draftId:string;reason:string};
const must=<T=any>(result:{data:unknown;error:unknown},message:string):T=>{if(result.error||!result.data)throw new ApiError(message,500,"DATABASE_BINDING_FAILED");return result.data as T};
const asRecord=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const num=(value:unknown,fallback:number)=>typeof value==="number"&&Number.isFinite(value)?value:fallback;
const text=(value:unknown,fallback="")=>typeof value==="string"?value:fallback;
const metadataTitle=(keyword:string)=>keyword.split(/\s+/).filter(Boolean).map((word,index)=>{const lower=word.toLowerCase();if(lower==="jax")return"Jacksonville,";if(lower==="fl")return"FL";if(["in","of","for","and","the"].includes(lower)&&index>0)return lower;return lower.charAt(0).toUpperCase()+lower.slice(1)}).join(" ").replace(/,\s*,/g,",").slice(0,65);

export async function creativeWorkspaceSnapshot(db:SupabaseClient,tenant:Omit<CreativeTenant,"userId">){
  const scope=(query:any)=>query.eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId);
  const[proof,specs,drafts,opportunities,leads]=await Promise.all([
    scope(db.from("business_proof_assets").select("id,proof_type,title,summary,source_url,storage_path,mime_type,service,location,facts,verification_status,captured_at,verified_at")).order("created_at",{ascending:false}).limit(100),
    scope(db.from("seo_creative_specs").select("id,opportunity_id,owner_page_url,target_keyword,search_intent,creative_angle,user_job,evidence_requirements,proof_asset_ids,required_sections,conversion_goal,status,quality_score,expected_value,created_at")).order("created_at",{ascending:false}).limit(100),
    scope(db.from("seo_creative_drafts").select("id,creative_spec_id,version,title,meta_description,h1,summary,sections,faqs,internal_links,cta,originality_score,evidence_coverage_score,helpfulness_score,conversion_score,qa_results,status,created_at")).order("created_at",{ascending:false}).limit(100),
    scope(db.from("seo_opportunities").select("id,keyword_id,opportunity_score,confidence_score,action_type,priority,target_milestone,evidence,recommended_actions,status")).eq("status","open").order("opportunity_score",{ascending:false}).limit(50),
    scope(db.from("seo_leads").select("id,source,landing_page_url,status,qualified,revenue,gross_profit,occurred_at")).order("occurred_at",{ascending:false}).limit(100)
  ]);
  for(const result of[proof,specs,drafts,opportunities,leads])if(result.error)throw new ApiError("Creative Studio needs migration 0018 before it can load.",503,"DATABASE_BINDING_FAILED");
  const keywordIds=(opportunities.data??[]).map((row:any)=>row.keyword_id).filter(Boolean) as string[];
  const keywords=keywordIds.length?await db.from("seo_keywords").select("id,keyword,normalized_keyword").eq("project_id",tenant.projectId).in("id",keywordIds):{data:[]};
  const keywordMap=new Map((keywords.data??[]).map(row=>[row.id,row.keyword]));
  const totalGrossProfit=(leads.data??[]).reduce((sum:number,row:any)=>sum+num(row.gross_profit,0),0);
  return{proof:proof.data??[],specs:specs.data??[],drafts:drafts.data??[],opportunities:(opportunities.data??[]).map((row:any)=>({...row,keyword:keywordMap.get(row.keyword_id)??text(asRecord(row.evidence).keyword,"Unmapped opportunity")})),leads:leads.data??[],summary:{verifiedProof:(proof.data??[]).filter((row:any)=>row.verification_status==="verified").length,proofNeeded:(specs.data??[]).filter((row:any)=>row.status==="evidence_needed").length,draftsToReview:(drafts.data??[]).filter((row:any)=>row.status==="awaiting_review").length,approvedDrafts:(drafts.data??[]).filter((row:any)=>row.status==="approved").length,attributedGrossProfit:+totalGrossProfit.toFixed(2)}};
}

export async function addBusinessProof(db:SupabaseClient,tenant:CreativeTenant,input:{proofType:string;title:string;summary:string;sourceUrl?:string;service?:string;location?:string;facts?:Record<string,unknown>;storagePath?:string;mimeType?:string}){
  return must(await db.from("business_proof_assets").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,proof_type:input.proofType,title:input.title,summary:input.summary,source_url:input.sourceUrl||null,storage_path:input.storagePath||null,mime_type:input.mimeType||null,service:input.service||null,location:input.location||null,facts:input.facts??{},captured_by:tenant.userId}).select("id,proof_type,title,verification_status").single(),"Business proof could not be saved. Apply migration 0018 and retry.");
}

export async function verifyBusinessProof(db:SupabaseClient,tenant:CreativeTenant,proofId:string,decision:"verified"|"rejected"){
  const result=await db.from("business_proof_assets").update({verification_status:decision,verified_by:tenant.userId,verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",proofId).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).select("id,verification_status").maybeSingle();
  if(result.error||!result.data)throw new ApiError("Business proof was not found in this client project.",404,"NOT_FOUND");
  const refreshedSpecIds=decision==="verified"?await refreshEvidenceNeededCreativeSpecs(db,tenant):[];
  const resumedCampaigns=decision==="verified"?await resumeEvidenceWaitingCreativeCampaigns(db,tenant):[];
  return{...result.data,refreshedSpecIds,resumedCampaigns};
}

function inferIntent(keyword:string){const value=keyword.toLowerCase();if(/near me|in [a-z]|city|county/.test(value))return"local transactional";if(/cost|price|quote|hire|company|service|contractor|repair|install/.test(value))return"commercial transactional";if(/how|what|why|guide|signs|when/.test(value))return"informational";return"commercial investigation";}

async function usableCreativeProof(db:SupabaseClient,tenant:Omit<CreativeTenant,"userId">){
  const[proofResult,claimsResult]=await Promise.all([
    db.from("business_proof_assets").select("id,proof_type,title,summary,facts,service,location").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("verification_status","verified").limit(30),
    db.from("business_claims").select("proof_asset_id").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("status","verified")
  ]);
  if(proofResult.error||claimsResult.error)throw new ApiError("Verified business proof could not be loaded.",500,"DATABASE_BINDING_FAILED");
  const approvedRestrictedProof=new Set((claimsResult.data??[]).map((claim:any)=>claim.proof_asset_id).filter(Boolean)),restricted=new Set(["credential","warranty","pricing_factor"]),proof=(proofResult.data??[]).filter((asset:any)=>!restricted.has(asset.proof_type)||approvedRestrictedProof.has(asset.id)),distinct=new Set(proof.map((row:any)=>row.proof_type));
  return{proof,ready:proof.length>=2&&distinct.size>=2};
}

async function refreshEvidenceNeededCreativeSpecs(db:SupabaseClient,tenant:CreativeTenant){
  const specs=await db.from("seo_creative_specs").select("id").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("status","evidence_needed").limit(100);
  if(specs.error)throw new ApiError("Creative specifications waiting for proof could not be loaded.",500,"DATABASE_BINDING_FAILED");
  const ids=(specs.data??[]).map((row:any)=>row.id);
  if(!ids.length)return[];
  const{proof,ready}=await usableCreativeProof(db,tenant),refreshed=await db.from("seo_creative_specs").update({proof_asset_ids:proof.map((row:any)=>row.id),status:ready?"ready":"evidence_needed",updated_at:new Date().toISOString()}).in("id",ids).eq("status","evidence_needed").select("id");
  if(refreshed.error)throw new ApiError("Creative specification evidence could not be refreshed.",500,"DATABASE_BINDING_FAILED");
  return(refreshed.data??[]).map((row:any)=>row.id);
}

export async function createCreativeSpec(db:SupabaseClient,tenant:CreativeTenant,opportunityId:string){
  const opportunity=must(await db.from("seo_opportunities").select("id,keyword_id,action_type,target_url,opportunity_score,confidence_score,evidence,recommended_actions,target_milestone").eq("id",opportunityId).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle(),"SEO opportunity was not found."),metadataOnly=opportunity.action_type==="IMPROVE";
  const existing=await db.from("seo_creative_specs").select("id,status,target_keyword,conversion_goal").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("opportunity_id",opportunityId).not("status","in","(rejected,implemented)").order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(existing.error)throw new ApiError("The creative specification state could not be loaded.",500,"DATABASE_BINDING_FAILED");
  if(existing.data&&existing.data.status!=="evidence_needed")return existing.data;
  if(existing.data){
    if(metadataOnly){
      const refreshed=await db.from("seo_creative_specs").update({owner_page_url:opportunity.target_url,evidence_requirements:["Verified search evidence and an existing public page","No new business, pricing, warranty, credential, or performance claims"],required_sections:[],visual_requirements:[],conversion_goal:{...asRecord(existing.data.conversion_goal),mode:"metadata_only",primary:"search_relevance"},restrictions:["Metadata and keyword alignment only","No new factual business claims"],status:"ready",updated_at:new Date().toISOString()}).eq("id",existing.data.id).eq("status","evidence_needed").select("id,status,target_keyword").maybeSingle();
      if(refreshed.error||!refreshed.data)throw new ApiError("The metadata creative specification could not be prepared.",500,"DATABASE_BINDING_FAILED");
      return refreshed.data;
    }
    const{proof,ready}=await usableCreativeProof(db,tenant),refreshed=await db.from("seo_creative_specs").update({proof_asset_ids:proof.map((row:any)=>row.id),status:ready?"ready":"evidence_needed",updated_at:new Date().toISOString()}).eq("id",existing.data.id).eq("status","evidence_needed").select("id,status,target_keyword").maybeSingle();
    if(refreshed.error||!refreshed.data)throw new ApiError("The creative specification evidence could not be refreshed.",500,"DATABASE_BINDING_FAILED");
    return refreshed.data;
  }
  const evidence=asRecord(opportunity.evidence),keywordRow=opportunity.keyword_id?await db.from("seo_keywords").select("keyword").eq("id",opportunity.keyword_id).eq("project_id",tenant.projectId).maybeSingle():null;
  const keyword=text(keywordRow?.data?.keyword,text(evidence.keyword,"Untitled search opportunity")),intent=inferIntent(keyword);
  const{proof,ready}=await usableCreativeProof(db,tenant);
  const monthlyImpressions=num(evidence.impressions,num(evidence.searchVolume,500));
  const expectedValue={...calculateBusinessValue({monthlyImpressions,currentCtr:num(evidence.ctr,.02),achievableCtr:num(evidence.achievableCtr,.055),leadConversionRate:num(evidence.leadConversionRate,.04),qualifiedLeadRate:num(evidence.qualifiedLeadRate,.65),closeRate:num(evidence.closeRate,.25),grossProfitPerSale:num(evidence.grossProfitPerSale,750),probabilityOfLift:num(opportunity.confidence_score,.5)/100,evidenceConfidence:num(opportunity.confidence_score,.5)/100,implementationCost:num(evidence.estimatedEffort,500),timeToSignalDays:num(evidence.timeToSignalDays,45),risk:"medium"}),basis:"directional",assumptions:{currentCtr:num(evidence.ctr,.02),achievableCtr:num(evidence.achievableCtr,.055),leadConversionRate:num(evidence.leadConversionRate,.04),qualifiedLeadRate:num(evidence.qualifiedLeadRate,.65),closeRate:num(evidence.closeRate,.25),grossProfitPerSale:num(evidence.grossProfitPerSale,750)}};
  const requiredSections=[{key:"answer",label:"Direct answer and service fit"},{key:"proof",label:"Verified local proof"},{key:"process",label:"What the customer can expect"},{key:"decision",label:"Selection factors and next step"},{key:"faq",label:"Real customer questions"}];
  const insert=await db.from("seo_creative_specs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,opportunity_id:opportunity.id,owner_page_url:opportunity.target_url,target_keyword:keyword,query_cluster:[keyword],search_intent:intent,creative_angle:metadataOnly?`Align the existing page metadata with ${keyword} without adding unsupported claims.`:`Answer ${keyword} with specific business proof and a low-friction next step`,user_job:metadataOnly?`Help search engines and customers understand the existing page's verified topic.`:`Help a searcher decide whether this business can solve ${keyword} in their market.`,evidence_requirements:metadataOnly?["Verified search evidence and an existing public page","No new business, pricing, warranty, credential, or performance claims"]:["At least two verified proof assets of different types","No pricing, warranty, credential, or performance claim without explicit approval"],proof_asset_ids:proof.map(row=>row.id),required_sections:metadataOnly?[]:requiredSections,visual_requirements:metadataOnly?[]:["Use a real project or process image when available","Add descriptive alt text tied to what is visibly shown"],conversion_goal:metadataOnly?{mode:"metadata_only",primary:"search_relevance"}:{primary:"qualified_lead",cta:"Request an evaluation or quote"},schema_plan:metadataOnly?[]:["Service","FAQPage when FAQs are visible"],restrictions:metadataOnly?["Metadata and keyword alignment only","No new factual business claims"]:["No fabricated testimonials","No unsupported superlatives","No doorway-page location swapping"],status:metadataOnly||ready?"ready":"evidence_needed",expected_value:expectedValue,created_by:tenant.userId}).select("id,status,target_keyword").single();
  return must(insert,"Creative specification could not be saved. Apply migration 0018 and retry.");
}

function scoreDraft(input:{creative:{title:string;metaDescription:string;sections:Array<{body:string;evidenceIds:string[]}>;faqs:unknown[];claimIdsUsed:string[];proofAssetIdsUsed:string[]};allowedProof:string[];allowedClaims:string[];threshold:number}){
  const unauthorizedProof=input.creative.proofAssetIdsUsed.filter(id=>!input.allowedProof.includes(id)),unauthorizedClaims=input.creative.claimIdsUsed.filter(id=>!input.allowedClaims.includes(id));
  const allowedEvidence=new Set([...input.allowedProof,...input.allowedClaims]),unauthorizedSectionEvidence=input.creative.sections.flatMap(section=>section.evidenceIds).filter(id=>!allowedEvidence.has(id));
  const evidenceCoverage=Math.min(100,input.creative.proofAssetIdsUsed.length*35+input.creative.claimIdsUsed.length*15),originality=Math.min(100,45+input.creative.proofAssetIdsUsed.length*18+input.creative.sections.length*4),helpfulness=Math.min(100,45+input.creative.sections.length*9+input.creative.faqs.length*4),conversion=input.creative.title.length<=65&&input.creative.metaDescription.length<=170?85:65;
  const riskyLanguage=input.creative.sections.some(section=>/(\$\s?\d|licensed|certified|guarantee|warranty|award|best|#1|years? (?:of )?experience)/i.test(section.body));
  const blockers=[...(unauthorizedProof.length?["Draft referenced unverified proof"]:[]),...(unauthorizedClaims.length?["Draft referenced an unapproved claim"]:[]),...(unauthorizedSectionEvidence.length?["A section cited evidence outside this client specification"]:[]),...(riskyLanguage&&!input.creative.claimIdsUsed.length?["Restricted factual language requires an explicitly approved claim"]:[]),...(evidenceCoverage<60?["Evidence coverage is below 60"]:[]),...(originality<input.threshold?[`Proof differentiation score is below ${input.threshold}`]:[])];
  return{evidenceCoverage,originality,originalityBasis:"Verified-proof differentiation heuristic (not a plagiarism detector).",helpfulness,conversion,blockers,passed:blockers.length===0};
}

export async function generateCreativeDraft(db:SupabaseClient,tenant:CreativeTenant,specId:string){
  const spec=must(await db.from("seo_creative_specs").select("*").eq("id",specId).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle(),"Creative specification was not found.");
  const metadataOnly=asRecord(spec.conversion_goal).mode==="metadata_only";
  if(spec.status==="generating")throw new ApiError("This creative specification is already being generated.",409,"CONFLICT");
  if(spec.status!=="ready"&&spec.status!=="generated")throw new ApiError("Add and verify at least two different types of business proof before generating copy.",409,"CREATIVE_EVIDENCE_REQUIRED");
  const proof=await db.from("business_proof_assets").select("id,proof_type,title,summary,facts,service,location").eq("project_id",tenant.projectId).eq("verification_status","verified").in("id",spec.proof_asset_ids??[]);
  const claims=await db.from("business_claims").select("id,proof_asset_id,claim_text,claim_type,evidence_refs").eq("project_id",tenant.projectId).eq("status","verified"),approvedProof=new Set((claims.data??[]).map((claim:any)=>claim.proof_asset_id).filter(Boolean)),restricted=new Set(["credential","warranty","pricing_factor"]),usableProof=(proof.data??[]).filter((asset:any)=>!restricted.has(asset.proof_type)||approvedProof.has(asset.id));
  if(!metadataOnly&&usableProof.length<2)throw new ApiError("Two verified, non-restricted proof assets are required. Pricing, warranty, and credential facts also need an approved claim.",409,"CREATIVE_EVIDENCE_REQUIRED");
  const claimed=await db.from("seo_creative_specs").update({status:"generating",updated_at:new Date().toISOString()}).eq("id",specId).in("status",["ready","generated"]).select("id").maybeSingle();
  if(claimed.error)throw new ApiError("The creative generation lock could not be acquired.",500,"DATABASE_BINDING_FAILED");
  if(!claimed.data)throw new ApiError("This creative specification is already being generated or is no longer eligible.",409,"CONFLICT");
  try{
    const generated=metadataOnly?{creative:{title:metadataTitle(spec.target_keyword),metaDescription:`Explore ${spec.target_keyword} information and the next steps available on this page.`.slice(0,170),h1:metadataTitle(spec.target_keyword),summary:`This metadata update aligns the existing public page with verified search demand without adding new factual business claims.`,sections:[],faqs:[],internalLinks:[],schemaMarkup:{},cta:{},claimIdsUsed:[],proofAssetIdsUsed:[]},responseId:null,model:"hdseo-metadata-v1"}:await generateEvidenceConstrainedCreative({spec:{targetKeyword:spec.target_keyword,searchIntent:spec.search_intent,creativeAngle:spec.creative_angle,userJob:spec.user_job,ownerPageUrl:spec.owner_page_url,requiredSections:spec.required_sections,internalLinkPlan:spec.internal_link_plan,conversionGoal:spec.conversion_goal,schemaPlan:spec.schema_plan,restrictions:spec.restrictions},verifiedProof:usableProof,approvedClaims:claims.data??[]},{db,tenant,idempotencyKey:`creative:${specId}:${crypto.randomUUID()}`});
    const qa=metadataOnly?{evidenceCoverage:100,originality:85,originalityBasis:"Verified search evidence applied to an existing page; no new claims generated.",helpfulness:85,conversion:85,blockers:[],passed:true}:scoreDraft({creative:generated.creative,allowedProof:usableProof.map((row:any)=>row.id),allowedClaims:(claims.data??[]).map((row:any)=>row.id),threshold:num(spec.originality_threshold,70)});
    const previous=await db.from("seo_creative_drafts").select("version").eq("creative_spec_id",specId).order("version",{ascending:false}).limit(1).maybeSingle(),version=(previous.data?.version??0)+1;
    const autoApproved=metadataOnly&&qa.passed,now=new Date().toISOString();
    const draft=must(await db.from("seo_creative_drafts").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,creative_spec_id:specId,version,model_provider:metadataOnly?"hdseo":"openai",model_name:generated.model,model_response_id:generated.responseId,title:generated.creative.title,meta_description:generated.creative.metaDescription,h1:generated.creative.h1,summary:generated.creative.summary,sections:generated.creative.sections,faqs:generated.creative.faqs,internal_links:generated.creative.internalLinks,schema_markup:generated.creative.schemaMarkup,cta:generated.creative.cta,claims_used:generated.creative.claimIdsUsed,proof_used:generated.creative.proofAssetIdsUsed,originality_score:qa.originality,evidence_coverage_score:qa.evidenceCoverage,helpfulness_score:qa.helpfulness,conversion_score:qa.conversion,qa_results:{...qa,mode:metadataOnly?"metadata_only":"evidence_constrained",autoApprovedPreparation:autoApproved},status:autoApproved?"approved":qa.passed?"awaiting_review":"qa_failed",requested_by:tenant.userId,approved_by:autoApproved?tenant.userId:null,approved_at:autoApproved?now:null}).select("id,status,title,qa_results").single(),"Generated creative could not be stored.");
    await db.from("seo_creative_specs").update({status:autoApproved?"approved":"generated",quality_score:(qa.originality+qa.evidenceCoverage+qa.helpfulness+qa.conversion)/4,updated_at:now}).eq("id",specId);return draft;
  }catch(error){await db.from("seo_creative_specs").update({status:"ready",updated_at:new Date().toISOString()}).eq("id",specId);throw error;}
}

/**
 * Move an approved BUILD/CONTENT recommendation into the proof-gated Creative
 * Studio workflow. Reusing an existing draft is important here: a repeated
 * approval request must not create duplicate model spend.
 */
export async function prepareCampaignCreativeHandoff(db:SupabaseClient,tenant:CreativeTenant,opportunityId:string):Promise<CampaignCreativeHandoff>{
  const spec=await createCreativeSpec(db,tenant,opportunityId);
  const specId=String(spec.id);
  if(spec.status==="evidence_needed")return{state:"evidence_required",specId,reason:"Verify at least two different types of business proof in Creative Studio before HD SEO writes the page."};

  const existing=await db.from("seo_creative_drafts").select("id,status,qa_results").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("creative_spec_id",specId).order("version",{ascending:false}).limit(1).maybeSingle();
  if(existing.error)throw new ApiError("The existing creative review state could not be loaded.",500,"DATABASE_BINDING_FAILED");
  if(existing.data?.status==="approved")return{state:"approved",specId,draftId:existing.data.id};
  if(existing.data?.status==="awaiting_review")return{state:"review_required",specId,draftId:existing.data.id};
  if(existing.data?.status==="qa_failed"){
    const blockers=Array.isArray(existing.data.qa_results?.blockers)?existing.data.qa_results.blockers.filter((item:unknown)=>typeof item==="string").join(" "):"";
    return{state:"revision_required",specId,draftId:existing.data.id,reason:blockers||"The generated draft needs another Creative Studio revision before it can be approved."};
  }
  if(spec.status==="approved")throw new ApiError("The approved creative specification has no approved draft.",409,"CREATIVE_QA_FAILED");

  try{
    const draft=await generateCreativeDraft(db,tenant,specId);
    if(draft.status==="approved")return{state:"approved",specId,draftId:draft.id};
    if(draft.status==="awaiting_review")return{state:"review_required",specId,draftId:draft.id};
    const blockers=Array.isArray(draft.qa_results?.blockers)?draft.qa_results.blockers.filter((item:unknown)=>typeof item==="string").join(" "):"";
    return{state:"revision_required",specId,draftId:draft.id,reason:blockers||"The generated draft did not pass deterministic QA and must be revised in Creative Studio."};
  }catch(error){
    if(error instanceof ApiError&&error.code==="CREATIVE_EVIDENCE_REQUIRED"){
      await db.from("seo_creative_specs").update({status:"evidence_needed",updated_at:new Date().toISOString()}).eq("id",specId).eq("project_id",tenant.projectId);
      return{state:"evidence_required",specId,reason:error.message};
    }
    throw error;
  }
}

async function resumeEvidenceWaitingCreativeCampaigns(db:SupabaseClient,tenant:CreativeTenant){
  const waiting=await db.from("seo_campaign_jobs").select("id,result,outcome_run_id").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("status","awaiting_creative_evidence").order("updated_at",{ascending:true}).limit(10);
  if(waiting.error)throw new ApiError("Creative campaigns waiting for proof could not be loaded.",500,"DATABASE_BINDING_FAILED");
  const resumed:Array<{campaignId:string;state:CampaignCreativeHandoff["state"]}> = [];
  for(const campaign of waiting.data??[]){
    const result=asRecord(campaign.result),opportunityId=typeof result.opportunityId==="string"?result.opportunityId:"";
    if(!opportunityId)continue;
    const creative=await prepareCampaignCreativeHandoff(db,tenant,opportunityId),ready=creative.state==="approved",status=ready?"queued":creative.state==="evidence_required"?"awaiting_creative_evidence":"awaiting_creative_review",nextResult={...result,creativeSpecId:creative.specId,...("draftId" in creative?{creativeDraftId:creative.draftId}:{}),creativeState:creative.state,requiredAction:"reason" in creative?creative.reason:creative.state==="review_required"?"Review and approve the QA-passed draft in Creative Studio.":null};
    const update=await db.from("seo_campaign_jobs").update({status,current_stage:ready?"inspect_repository":"prepare",progress_percent:ready?65:60,next_attempt_at:new Date().toISOString(),result:nextResult,updated_at:new Date().toISOString()}).eq("id",campaign.id).eq("status","awaiting_creative_evidence").select("id").maybeSingle();
    if(update.error)throw new ApiError("A campaign could not resume after business proof was verified.",500,"DATABASE_BINDING_FAILED");
    if(!update.data)continue;
    if(campaign.outcome_run_id){
      const run=await db.from("outcome_loop_runs").update({status:ready?"implementing":"awaiting_approval",current_step:ready?"implementation":"approval",updated_at:new Date().toISOString()}).eq("id",campaign.outcome_run_id).eq("project_id",tenant.projectId);
      if(run.error)throw new ApiError("The managed outcome state could not resume after proof verification.",500,"DATABASE_BINDING_FAILED");
    }
    resumed.push({campaignId:campaign.id,state:creative.state});
  }
  return resumed;
}

export async function approveCreativeDraft(db:SupabaseClient,tenant:CreativeTenant,draftId:string){
  const draft=must(await db.from("seo_creative_drafts").select("id,creative_spec_id,status,qa_results,title").eq("id",draftId).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle(),"Creative draft was not found.");
  if(draft.status!=="awaiting_review"&&draft.status!=="approved")throw new ApiError("Only a draft that passed QA can be approved.",409,"CREATIVE_QA_FAILED");
  const now=new Date().toISOString();
  if(draft.status==="awaiting_review"){
    const approved=await db.from("seo_creative_drafts").update({status:"approved",approved_by:tenant.userId,approved_at:now,updated_at:now}).eq("id",draftId).eq("status","awaiting_review");
    if(approved.error)throw new ApiError("The creative approval could not be saved.",500,"DATABASE_BINDING_FAILED");
  }
  const approvedSpec=await db.from("seo_creative_specs").update({status:"approved",updated_at:now}).eq("id",draft.creative_spec_id).eq("project_id",tenant.projectId);
  if(approvedSpec.error)throw new ApiError("The approved creative specification could not be saved.",500,"DATABASE_BINDING_FAILED");

  const campaigns=await db.from("seo_campaign_jobs").select("id,outcome_run_id").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("status","awaiting_creative_review").contains("result",{creativeDraftId:draftId});
  if(campaigns.error)throw new ApiError("The approved campaign could not be resumed.",500,"DATABASE_BINDING_FAILED");
  const campaignIds=(campaigns.data??[]).map((row:any)=>row.id),outcomeRunIds=(campaigns.data??[]).map((row:any)=>row.outcome_run_id).filter(Boolean);
  if(campaignIds.length){
    const resumed=await db.from("seo_campaign_jobs").update({status:"queued",current_stage:"inspect_repository",progress_percent:65,next_attempt_at:now,updated_at:now}).in("id",campaignIds).eq("status","awaiting_creative_review");
    if(resumed.error)throw new ApiError("The approved campaign could not be resumed.",500,"DATABASE_BINDING_FAILED");
  }
  if(outcomeRunIds.length)await db.from("outcome_loop_runs").update({status:"implementing",current_step:"implementation",updated_at:now}).in("id",outcomeRunIds).eq("project_id",tenant.projectId);
  return{id:draftId,status:"approved",title:draft.title,resumedCampaignIds:campaignIds};
}
