import "server-only";
/* Supabase's generated client cannot type tables until migration 0018 has been applied and types regenerated. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type{SupabaseClient}from "@supabase/supabase-js";
import{ApiError}from "@/lib/api/errors";
import{generateEvidenceConstrainedCreative}from "@/lib/creatives/openai";
import{calculateBusinessValue}from "@/lib/seo/business-value";

export type CreativeTenant={agencyId:string;clientId:string;projectId:string;userId:string|null};
const must=<T=any>(result:{data:unknown;error:unknown},message:string):T=>{if(result.error||!result.data)throw new ApiError(message,500,"DATABASE_BINDING_FAILED");return result.data as T};
const asRecord=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const num=(value:unknown,fallback:number)=>typeof value==="number"&&Number.isFinite(value)?value:fallback;
const text=(value:unknown,fallback="")=>typeof value==="string"?value:fallback;

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
  if(result.error||!result.data)throw new ApiError("Business proof was not found in this client project.",404,"NOT_FOUND");return result.data;
}

function inferIntent(keyword:string){const value=keyword.toLowerCase();if(/near me|in [a-z]|city|county/.test(value))return"local transactional";if(/cost|price|quote|hire|company|service|contractor|repair|install/.test(value))return"commercial transactional";if(/how|what|why|guide|signs|when/.test(value))return"informational";return"commercial investigation";}

export async function createCreativeSpec(db:SupabaseClient,tenant:CreativeTenant,opportunityId:string){
  const existing=await db.from("seo_creative_specs").select("id,status,target_keyword").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("opportunity_id",opportunityId).not("status","in","(rejected,implemented)").order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(existing.data)return existing.data;
  const opportunity=must(await db.from("seo_opportunities").select("id,keyword_id,action_type,opportunity_score,confidence_score,evidence,recommended_actions,target_milestone").eq("id",opportunityId).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle(),"SEO opportunity was not found.");
  const evidence=asRecord(opportunity.evidence),keywordRow=opportunity.keyword_id?await db.from("seo_keywords").select("keyword").eq("id",opportunity.keyword_id).eq("project_id",tenant.projectId).maybeSingle():null;
  const keyword=text(keywordRow?.data?.keyword,text(evidence.keyword,"Untitled search opportunity")),intent=inferIntent(keyword);
  const proofResult=await db.from("business_proof_assets").select("id,proof_type,title,summary,facts,service,location").eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).eq("verification_status","verified").limit(30);
  if(proofResult.error)throw new ApiError("Verified business proof could not be loaded.",500,"DATABASE_BINDING_FAILED");
  const proof=proofResult.data??[],distinct=new Set(proof.map(row=>row.proof_type)),ready=proof.length>=2&&distinct.size>=2;
  const monthlyImpressions=num(evidence.impressions,num(evidence.searchVolume,500));
  const expectedValue={...calculateBusinessValue({monthlyImpressions,currentCtr:num(evidence.ctr,.02),achievableCtr:num(evidence.achievableCtr,.055),leadConversionRate:num(evidence.leadConversionRate,.04),qualifiedLeadRate:num(evidence.qualifiedLeadRate,.65),closeRate:num(evidence.closeRate,.25),grossProfitPerSale:num(evidence.grossProfitPerSale,750),probabilityOfLift:num(opportunity.confidence_score,.5)/100,evidenceConfidence:num(opportunity.confidence_score,.5)/100,implementationCost:num(evidence.estimatedEffort,500),timeToSignalDays:num(evidence.timeToSignalDays,45),risk:"medium"}),basis:"directional",assumptions:{currentCtr:num(evidence.ctr,.02),achievableCtr:num(evidence.achievableCtr,.055),leadConversionRate:num(evidence.leadConversionRate,.04),qualifiedLeadRate:num(evidence.qualifiedLeadRate,.65),closeRate:num(evidence.closeRate,.25),grossProfitPerSale:num(evidence.grossProfitPerSale,750)}};
  const requiredSections=[{key:"answer",label:"Direct answer and service fit"},{key:"proof",label:"Verified local proof"},{key:"process",label:"What the customer can expect"},{key:"decision",label:"Selection factors and next step"},{key:"faq",label:"Real customer questions"}];
  const insert=await db.from("seo_creative_specs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,opportunity_id:opportunity.id,target_keyword:keyword,query_cluster:[keyword],search_intent:intent,creative_angle:`Answer ${keyword} with specific business proof and a low-friction next step`,user_job:`Help a searcher decide whether this business can solve ${keyword} in their market.`,evidence_requirements:["At least two verified proof assets of different types","No pricing, warranty, credential, or performance claim without explicit approval"],proof_asset_ids:proof.map(row=>row.id),required_sections:requiredSections,visual_requirements:["Use a real project or process image when available","Add descriptive alt text tied to what is visibly shown"],conversion_goal:{primary:"qualified_lead",cta:"Request an evaluation or quote"},schema_plan:["Service","FAQPage when FAQs are visible"],restrictions:["No fabricated testimonials","No unsupported superlatives","No doorway-page location swapping"],status:ready?"ready":"evidence_needed",expected_value:expectedValue,created_by:tenant.userId}).select("id,status,target_keyword").single();
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
  if(spec.status!=="ready"&&spec.status!=="generated")throw new ApiError("Add and verify at least two different types of business proof before generating copy.",409,"CREATIVE_EVIDENCE_REQUIRED");
  const proof=await db.from("business_proof_assets").select("id,proof_type,title,summary,facts,service,location").eq("project_id",tenant.projectId).eq("verification_status","verified").in("id",spec.proof_asset_ids??[]);
  const claims=await db.from("business_claims").select("id,proof_asset_id,claim_text,claim_type,evidence_refs").eq("project_id",tenant.projectId).eq("status","verified"),approvedProof=new Set((claims.data??[]).map((claim:any)=>claim.proof_asset_id).filter(Boolean)),restricted=new Set(["credential","warranty","pricing_factor"]),usableProof=(proof.data??[]).filter((asset:any)=>!restricted.has(asset.proof_type)||approvedProof.has(asset.id));
  if(usableProof.length<2)throw new ApiError("Two verified, non-restricted proof assets are required. Pricing, warranty, and credential facts also need an approved claim.",409,"CREATIVE_EVIDENCE_REQUIRED");
  await db.from("seo_creative_specs").update({status:"generating",updated_at:new Date().toISOString()}).eq("id",specId);
  try{
    const generated=await generateEvidenceConstrainedCreative({spec:{targetKeyword:spec.target_keyword,searchIntent:spec.search_intent,creativeAngle:spec.creative_angle,userJob:spec.user_job,ownerPageUrl:spec.owner_page_url,requiredSections:spec.required_sections,internalLinkPlan:spec.internal_link_plan,conversionGoal:spec.conversion_goal,schemaPlan:spec.schema_plan,restrictions:spec.restrictions},verifiedProof:usableProof,approvedClaims:claims.data??[]},{db,tenant,idempotencyKey:`creative:${specId}:${crypto.randomUUID()}`});
    const qa=scoreDraft({creative:generated.creative,allowedProof:usableProof.map((row:any)=>row.id),allowedClaims:(claims.data??[]).map((row:any)=>row.id),threshold:num(spec.originality_threshold,70)});
    const previous=await db.from("seo_creative_drafts").select("version").eq("creative_spec_id",specId).order("version",{ascending:false}).limit(1).maybeSingle(),version=(previous.data?.version??0)+1;
    const draft=must(await db.from("seo_creative_drafts").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,creative_spec_id:specId,version,model_provider:"openai",model_name:generated.model,model_response_id:generated.responseId,title:generated.creative.title,meta_description:generated.creative.metaDescription,h1:generated.creative.h1,summary:generated.creative.summary,sections:generated.creative.sections,faqs:generated.creative.faqs,internal_links:generated.creative.internalLinks,schema_markup:generated.creative.schemaMarkup,cta:generated.creative.cta,claims_used:generated.creative.claimIdsUsed,proof_used:generated.creative.proofAssetIdsUsed,originality_score:qa.originality,evidence_coverage_score:qa.evidenceCoverage,helpfulness_score:qa.helpfulness,conversion_score:qa.conversion,qa_results:qa,status:qa.passed?"awaiting_review":"qa_failed",requested_by:tenant.userId}).select("id,status,title,qa_results").single(),"Generated creative could not be stored.");
    await db.from("seo_creative_specs").update({status:"generated",quality_score:(qa.originality+qa.evidenceCoverage+qa.helpfulness+qa.conversion)/4,updated_at:new Date().toISOString()}).eq("id",specId);return draft;
  }catch(error){await db.from("seo_creative_specs").update({status:"ready",updated_at:new Date().toISOString()}).eq("id",specId);throw error;}
}

export async function approveCreativeDraft(db:SupabaseClient,tenant:CreativeTenant,draftId:string){
  const draft=must(await db.from("seo_creative_drafts").select("id,creative_spec_id,status,qa_results,title").eq("id",draftId).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle(),"Creative draft was not found.");
  if(draft.status!=="awaiting_review")throw new ApiError("Only a draft that passed QA can be approved.",409,"CREATIVE_QA_FAILED");
  const now=new Date().toISOString();await db.from("seo_creative_drafts").update({status:"approved",approved_by:tenant.userId,approved_at:now,updated_at:now}).eq("id",draftId);await db.from("seo_creative_specs").update({status:"approved",updated_at:now}).eq("id",draft.creative_spec_id);
  return{id:draftId,status:"approved",title:draft.title};
}
