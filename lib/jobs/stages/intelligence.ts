import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { systemReadiness } from "@/lib/readiness/system-readiness";
import { scoreOpportunity } from "@/lib/seo/opportunity-engine";
import { analyzePageOwnership } from "@/lib/seo/page-ownership";
import { evaluateEligibility, opportunityKey, selectNextBestAction } from "@/lib/seo/eligibility";
import { advance, complete, pause } from "../helpers";
import type { CampaignJob } from "../types";
import { selectImplementationPath } from "@/lib/seo/implementation-path";
import {
  importSearchConsoleDiscovery,
  runAuthorizedDomainDiscovery,
} from "@/lib/seo/autonomous-discovery";
import { classifySite } from "@/lib/seo/site-classifier";
import { buildWorkflowPlan } from "@/lib/seo/workflow-registry";
import { env, hasDataForSeoConfig } from "@/lib/config/env";
import { evidenceFreshness,queueStaleEvidence } from "@/lib/evidence/freshness";
import { resolveLabsLocation } from "@/lib/providers/dataforseo/locations";
import { valueOpportunity, type EconomicAssumptions } from "@/lib/seo/opportunity-value";

const inputNumber=(value:unknown,fallback:number)=>Number.isFinite(Number(value))?Number(value):fallback;

export async function discoverStage(db:SupabaseClient,job:CampaignJob){
  const tenant={agencyId:job.agency_id,clientId:job.client_organization_id,projectId:job.project_id,requestedBy:job.requested_by};
  const continueWhenFresh=async(source:Record<string,unknown>)=>{
    const freshness=await evidenceFreshness(db,tenant),queued= freshness.ready?[]:await queueStaleEvidence(db,tenant,freshness);
    if(!freshness.ready&&queued.length)return pause(db,job,"awaiting_evidence_refresh",{reason:"EVIDENCE_REFRESH_REQUIRED",staleEvidence:freshness.stale,queuedJobs:queued});
    if(!freshness.ready)return pause(db,job,"awaiting_data_connection",{reason:"EVIDENCE_REFRESH_REQUIRED",staleEvidence:freshness.stale,message:"Connect Search Console or authorize a bounded provider refresh before scoring."});
    return advance(db,job,"validate",{...source,evidenceFreshness:freshness});
  };
  const existing=await db.from("seo_keywords").select("id",{count:"exact",head:true}).eq("project_id",job.project_id).eq("status","active");
  if((existing.count??0)>0){
    const firstParty=await importSearchConsoleDiscovery(db,tenant,Math.min(250,inputNumber(job.input.discoveryLimit,100)));
    return continueWhenFresh({source:"existing_evidence",keywords:existing.count??0,refreshed:firstParty});
  }
  const firstParty=await importSearchConsoleDiscovery(db,tenant,Math.min(250,inputNumber(job.input.discoveryLimit,100)));
  if(firstParty.keywords>0)return continueWhenFresh(firstParty);
  const confirmationId=typeof job.input.discoveryConfirmationId==="string"?job.input.discoveryConfirmationId:null;
  if(confirmationId){
    const project=await db.from("seo_projects").select("domain,country_code,language_code").eq("id",job.project_id).single();
    if(!project.data)throw new ApiError("Project discovery settings are unavailable.",409,"CONFLICT",job.reference_id);
    const providerLocationCode=inputNumber(job.input.dataForSeoLocationCode,0)||(
      await resolveLabsLocation(project.data.country_code||"US",project.data.language_code||"en")
    ).locationCode;
    const provider=await runAuthorizedDomainDiscovery(db,{...tenant,confirmationId,domain:project.data.domain,targetMarket:typeof job.input.targetMarket==="string"?job.input.targetMarket:"United States",locationCode:providerLocationCode,languageCode:project.data.language_code||"en",monthlyBudget:inputNumber(job.input.monthlyBudget,1500),limit:Math.min(env.MAX_KEYWORDS_PER_RUN,Math.max(1,inputNumber(job.input.discoveryLimit,50)))});
    if(provider.keywords>0)return continueWhenFresh(provider);
  }
  return pause(db,job,"awaiting_data_connection",{reason:"NO_DISCOVERY_EVIDENCE",message:"Connect Google Search Console or authorize bounded domain discovery. A manual keyword list is not required."});
}

export async function validateStage(db:SupabaseClient,job:CampaignJob){const readiness=await systemReadiness(job.project_id);if(!readiness.ready)throw new ApiError("The SEO automation foundation is not ready.",409,"CONFLICT",job.reference_id);if(!readiness.evidence.keywords)throw new ApiError("Automatic discovery completed without usable keyword evidence.",409,"CONFLICT",job.reference_id);return advance(db,job,"snapshot",{readiness});}

export async function snapshotStage(db:SupabaseClient,job:CampaignJob){
  const [keywords,metrics,rankings,pages,competitors,audits,services,locations,searchConsole,project]=await Promise.all([
    db.from("seo_keywords").select("id",{count:"exact",head:true}).eq("project_id",job.project_id),
    db.from("keyword_metric_snapshots").select("id",{count:"exact",head:true}).eq("project_id",job.project_id),
    db.from("organic_ranking_snapshots").select("id",{count:"exact",head:true}).eq("project_id",job.project_id),
    db.from("seo_page_snapshots").select("url,title,h1,schema_types,captured_at").eq("project_id",job.project_id).order("captured_at",{ascending:false}).limit(500),
    db.from("competitor_domains").select("id",{count:"exact",head:true}).eq("project_id",job.project_id),
    db.from("site_audits").select("id",{count:"exact",head:true}).eq("project_id",job.project_id),
    db.from("seo_services").select("id",{count:"exact",head:true}).eq("project_id",job.project_id).eq("status","active"),
    db.from("seo_locations").select("id",{count:"exact",head:true}).eq("project_id",job.project_id).eq("status","active"),
    db.from("search_console_rows").select("id",{count:"exact",head:true}).eq("project_id",job.project_id),
    db.from("seo_projects").select("industry,country_code,language_code").eq("id",job.project_id).single(),
  ]);
  const pageRows=pages.data??[],classification=classifySite({industry:project.data?.industry,countryCode:project.data?.country_code,languageCode:project.data?.language_code,serviceCount:services.count??0,locationCount:locations.count??0,pages:pageRows.map(page=>({url:page.url,title:page.title,h1:page.h1,schemaTypes:(page.schema_types??[]) as string[]}))}),counts={keywords:keywords.count??0,metrics:metrics.count??0,rankings:rankings.count??0,pages:pageRows.length,competitors:competitors.count??0,audits:audits.count??0,services:services.count??0,locations:locations.count??0,searchConsoleRows:searchConsole.count??0},workflowPlan=buildWorkflowPlan({classification,pageCount:counts.pages,keywordCount:counts.keywords,hasSearchConsole:counts.searchConsoleRows>0,hasDataForSeo:hasDataForSeoConfig,hasBaseline:counts.pages>0});
  return advance(db,job,"score",{counts,classification,workflowPlan,capturedAt:new Date().toISOString()});
}

type KeywordRow={id:string;keyword:string;commercial_intent_score:number|null;target_url:string|null;priority:number;service_id:string|null;location_id:string|null};
const numeric=(value:unknown,fallback:number|null=null)=>Number.isFinite(Number(value))?Number(value):fallback;
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const firstNumber=(source:Record<string,unknown>,keys:string[],fallback:number|null)=>{for(const key of keys){const value=numeric(source[key]);if(value!=null)return value;}return fallback;};
const normalizedQuery=(value:string)=>value.trim().toLocaleLowerCase("en-US").replace(/\s+/g," ");

export async function scoreStage(db:SupabaseClient,job:CampaignJob){
  const since90=new Date(Date.now()-90*86_400_000).toISOString().slice(0,10),since180=new Date(Date.now()-180*86_400_000).toISOString();
  const [keywordResult,metricResult,rankingResult,pageResult,competitorResult,auditResult,campaignResult,analyticsResult,leadResult,gscResult]=await Promise.all([
    db.from("seo_keywords").select("id,keyword,commercial_intent_score,target_url,priority,service_id,location_id").eq("project_id",job.project_id).eq("status","active").limit(500),
    db.from("keyword_metric_snapshots").select("keyword_id,search_volume,cpc,keyword_difficulty,captured_at").eq("project_id",job.project_id).order("captured_at",{ascending:false}).limit(2000),
    db.from("organic_ranking_snapshots").select("keyword_id,position,ranking_url,collected_at").eq("project_id",job.project_id).order("collected_at",{ascending:false}).limit(3000),
    db.from("seo_page_snapshots").select("url,title,meta_description,h1,canonical,headings,internal_links,assigned_keywords").eq("project_id",job.project_id).order("captured_at",{ascending:false}).limit(500),
    db.from("competitor_domains").select("id",{count:"exact",head:true}).eq("project_id",job.project_id),
    db.from("site_audits").select("score,status").eq("project_id",job.project_id).order("created_at",{ascending:false}).limit(1),
    job.campaign_id?db.from("seo_campaigns").select("business_economics,implementation_budget").eq("id",job.campaign_id).maybeSingle():Promise.resolve({data:null,error:null}),
    db.from("analytics_daily_metrics").select("organic_sessions,conversions,gross_profit").eq("project_id",job.project_id).gte("metric_date",since90).limit(5000),
    db.from("seo_leads").select("qualified,status,gross_profit").eq("project_id",job.project_id).gte("occurred_at",since180).limit(2000),
    db.from("search_console_rows").select("query,clicks,impressions,ctr").eq("project_id",job.project_id).gte("date",since90).limit(10000),
  ]);
  const latestMetric=new Map<string,Record<string,unknown>>(),rankingHistory=new Map<string,Array<Record<string,unknown>>>();
  for(const row of metricResult.data??[])if(row.keyword_id&&!latestMetric.has(row.keyword_id))latestMetric.set(row.keyword_id,row);
  for(const row of rankingResult.data??[]){if(!row.keyword_id)continue;const rows=rankingHistory.get(row.keyword_id)??[];if(rows.length<2)rows.push(row);rankingHistory.set(row.keyword_id,rows);}
  const pages=(pageResult.data??[]).map((page)=>({url:page.url,title:page.title,metaDescription:page.meta_description,h1:page.h1,canonical:page.canonical,headings:(page.headings??[]) as string[],internalLinks:(page.internal_links??[]) as string[],assignedKeywords:(page.assigned_keywords??[]) as string[]}));
  const analytics=(analyticsResult.data??[]).reduce((sum,row)=>({sessions:sum.sessions+Number(row.organic_sessions??0),conversions:sum.conversions+Number(row.conversions??0)}),{sessions:0,conversions:0}),leads=leadResult.data??[],qualified=leads.filter(row=>row.qualified).length,sales=leads.filter(row=>Number(row.gross_profit??0)>0||/won|closed|booked/i.test(String(row.status))).length,totalGrossProfit=leads.reduce((sum,row)=>sum+Number(row.gross_profit??0),0),campaignEconomics=record(campaignResult.data?.business_economics),observed:EconomicAssumptions={leadConversionRate:analytics.sessions>0?analytics.conversions/analytics.sessions:null,qualifiedLeadRate:leads.length?qualified/leads.length:null,closeRate:qualified?sales/qualified:null,grossProfitPerSale:sales?totalGrossProfit/sales:null,implementationCost:numeric(campaignResult.data?.implementation_budget)};
  const economics: EconomicAssumptions={leadConversionRate:firstNumber(campaignEconomics,["leadConversionRate","lead_conversion_rate"],observed.leadConversionRate??null),qualifiedLeadRate:firstNumber(campaignEconomics,["qualifiedLeadRate","qualified_lead_rate"],observed.qualifiedLeadRate??null),closeRate:firstNumber(campaignEconomics,["closeRate","close_rate"],observed.closeRate??null),grossProfitPerSale:firstNumber(campaignEconomics,["grossProfitPerSale","gross_profit_per_sale"],observed.grossProfitPerSale??null),implementationCost:firstNumber(campaignEconomics,["implementationCost","implementation_cost"],observed.implementationCost??null)};
  const queryEvidence=new Map<string,{clicks:number;impressions:number}>();for(const row of gscResult.data??[]){if(!row.query)continue;const key=normalizedQuery(row.query),current=queryEvidence.get(key)??{clicks:0,impressions:0};current.clicks+=Number(row.clicks??0);current.impressions+=Number(row.impressions??0);queryEvidence.set(key,current);}
  const candidates=[];
  for(const keyword of (keywordResult.data??[]) as KeywordRow[]){
    const metric=latestMetric.get(keyword.id),ranks=rankingHistory.get(keyword.id)??[],current=ranks[0],previous=ranks[1],ownership=analyzePageOwnership(keyword.keyword,pages),result=scoreOpportunity({currentRank:current?.position==null?null:Number(current.position),previousRank:previous?.position==null?null:Number(previous.position),searchVolume:metric?.search_volume==null?null:Number(metric.search_volume),cpc:metric?.cpc==null?null:Number(metric.cpc),commercialIntentScore:keyword.commercial_intent_score,serviceRelevance:keyword.service_id?90:55,locationRelevance:keyword.location_id?90:55,competitorGap:(competitorResult.count??0)>0?70:null,technicalReadiness:auditResult.data?.[0]?.score==null?null:Number(auditResult.data[0].score),hasOwnerPage:Boolean(ownership.ownerPage),internalLinkCount:ownership.ownerPage?.internalLinks?.length??null}),gsc=queryEvidence.get(normalizedQuery(keyword.keyword)),value=valueOpportunity({seoScore:result.opportunityScore,confidenceScore:result.confidenceScore,searchVolume:numeric(metric?.search_volume),impressions:gsc?.impressions?gsc.impressions/3:null,currentCtr:gsc?.impressions?gsc.clicks/gsc.impressions:null,currentRank:numeric(current?.position),targetMilestone:result.targetMilestone,actionType:result.actionType,economics}),key=opportunityKey(job.project_id,keyword.keyword,keyword.target_url,result.actionType),existing=await db.from("seo_opportunities").select("id,status,cooldown_until").eq("project_id",job.project_id).eq("opportunity_key",key).in("status",["open","approved","in_progress","monitoring"]).maybeSingle(),eligibility=evaluateEligibility({projectId:job.project_id,keyword:keyword.keyword,targetUrl:keyword.target_url,result,pageConflict:ownership.conflictWarnings.length>0,activeDuplicate:false,cooldownUntil:existing.data?.cooldown_until,evidenceRequired:result.missingEvidence.length>3?result.missingEvidence:[]}),scoreBreakdown={...Object.fromEntries(result.evidence.map((factor)=>[factor.label,factor.points])),"Expected profit":value.businessValue.priorityScore},priority=value.combinedScore>=90?"critical":value.combinedScore>=75?"high":value.combinedScore>=55?"medium":"low",evidence={keyword:keyword.keyword,currentRank:current?.position??null,rankingUrl:current?.ranking_url??null,searchVolume:metric?.search_volume??null,impressions:gsc?.impressions??null,ctr:gsc?.impressions?gsc.clicks/gsc.impressions:null,ownership,missingEvidence:result.missingEvidence,scoreBreakdown,businessValue:value.businessValue,economicsConfidence:value.economicsConfidence,valueExplanation:value.explanation,economicAssumptions:value.assumptions};
    const values={agency_id:job.agency_id,client_organization_id:job.client_organization_id,project_id:job.project_id,keyword_id:keyword.id,opportunity_score:value.combinedScore,confidence_score:result.confidenceScore,action_type:result.actionType,priority,target_milestone:result.targetMilestone,reason_codes:result.reasonCodes,evidence,recommended_actions:result.recommendedActions,status:existing.data?.status??"open",scoring_version:"3.0-profit",opportunity_key:key,target_url:keyword.target_url};
    const saved=existing.data?await db.from("seo_opportunities").update(values).eq("id",existing.data.id).select("id").single():await db.from("seo_opportunities").insert(values).select("id").single();
    if(saved.data)candidates.push({job_id:job.id,opportunity_id:saved.data.id,eligibility_status:eligibility.eligible?"eligible":"blocked",score:value.combinedScore,confidence:result.confidenceScore,target_milestone:result.targetMilestone,score_breakdown:scoreBreakdown,evidence,missing_evidence:result.missingEvidence,deferred_reason:eligibility.reasons.join(", ")||null,targetUrl:keyword.target_url});
  }
  if(candidates.length){await db.from("seo_campaign_candidates").delete().eq("job_id",job.id);await db.from("seo_campaign_candidates").insert(candidates.map((candidate)=>({job_id:candidate.job_id,opportunity_id:candidate.opportunity_id,eligibility_status:candidate.eligibility_status,score:candidate.score,confidence:candidate.confidence,target_milestone:candidate.target_milestone,score_breakdown:candidate.score_breakdown,evidence:candidate.evidence,missing_evidence:candidate.missing_evidence,deferred_reason:candidate.deferred_reason})));}
  return advance(db,job,"select",{candidates:candidates.length,eligible:candidates.filter((candidate)=>candidate.eligibility_status==="eligible").length});
}

export async function selectStage(db:SupabaseClient,job:CampaignJob){const result=await db.from("seo_campaign_candidates").select("id,opportunity_id,score,confidence,eligibility_status,seo_opportunities(target_url)").eq("job_id",job.id);const selected=selectNextBestAction((result.data??[]).map((row)=>({opportunityId:row.opportunity_id,score:row.score,confidence:row.confidence,eligible:row.eligibility_status==="eligible",targetUrl:(Array.isArray(row.seo_opportunities)?row.seo_opportunities[0]:row.seo_opportunities)?.target_url})));if(!selected)throw new ApiError("No eligible evidence-backed opportunity is available.",409,"CONFLICT",job.reference_id);await Promise.all([db.from("seo_campaign_candidates").update({eligibility_status:"selected",selection_reason:"Highest confidence-adjusted expected-profit score after local relevance and safety gates."}).eq("job_id",job.id).eq("opportunity_id",selected.opportunityId),db.from("seo_campaign_candidates").update({eligibility_status:"deferred",deferred_reason:"A higher expected-value eligible action was selected."}).eq("job_id",job.id).neq("opportunity_id",selected.opportunityId).eq("eligibility_status","eligible")]);const withSelection={...job,result:{...job.result,opportunityId:selected.opportunityId}};await db.from("seo_campaign_jobs").update({result:withSelection.result}).eq("id",job.id);if(job.input.managedDiscoveryOnly===true)return complete(db,withSelection,{opportunityId:selected.opportunityId,managedDiscoveryOnly:true,billable:false,message:"Evidence discovery completed. The managed outcome scheduler will reserve capacity only when implementation work begins."});return advance(db,withSelection,"prepare",{opportunityId:selected.opportunityId});}

export async function prepareStage(db:SupabaseClient,job:CampaignJob){const latest=await db.from("seo_campaign_jobs").select("result,input").eq("id",job.id).single(),opportunityId=latest.data?.result?.opportunityId as string|undefined;if(!opportunityId)throw new ApiError("The selected opportunity is unavailable.",409,"CONFLICT",job.reference_id);const [opportunity,cms,gate]=await Promise.all([db.from("seo_opportunities").select("action_type,target_url,evidence,recommended_actions,priority").eq("id",opportunityId).single(),db.from("cms_connections").select("cms_type").eq("project_id",job.project_id).limit(1).maybeSingle(),db.rpc("github_execution_readiness",{target_agency:job.agency_id,target_project:job.project_id})]),requested=latest.data?.input?.automationMode==="EXECUTE_WITH_APPROVAL",decision=selectImplementationPath({cmsType:cms.data?.cms_type,actionType:opportunity.data?.action_type??"IMPROVE",repositoryRequested:requested,repositoryReady:Boolean(gate.data?.ready)}),evidence=record(opportunity.data?.evidence),valueExplanation=typeof evidence.valueExplanation==="string"?evidence.valueExplanation:"HD SEO selected this as the strongest evidence-backed opportunity in the approved market.",businessValue=record(evidence.businessValue),plainSummary=`HD SEO found the best available ${String(opportunity.data?.action_type??"SEO").toLowerCase()} opportunity. ${valueExplanation} Nothing will publish until an authorized person approves the exact change.`;const draft=await db.from("seo_action_drafts").insert({agency_id:job.agency_id,client_organization_id:job.client_organization_id,project_id:job.project_id,opportunity_id:opportunityId,execution_path:decision.path,status:"draft",target_url:opportunity.data?.target_url,evidence_snapshot:opportunity.data?.evidence??{},content_brief:{recommendedActions:opportunity.data?.recommended_actions??[],pathReason:decision.reason,risk:decision.risk,plainSummary,expectedValue:businessValue,approvalQuestion:"Should HD SEO prepare this change for a validated preview?"},created_by:job.requested_by}).select("id").single();if(!draft.data)throw new ApiError("The implementation draft could not be created.",500,"OPERATION_FAILED",job.reference_id);await db.from("seo_tasks").insert({agency_id:job.agency_id,client_organization_id:job.client_organization_id,project_id:job.project_id,draft_id:draft.data.id,title:"Approve HD SEO's highest-value recommendation",status:"awaiting_review",priority:opportunity.data?.priority??"high",client_visible_notes:plainSummary,created_by:job.requested_by});return pause(db,{...job,result:{...job.result,opportunityId}},"awaiting_opportunity_review",{opportunityId,draftId:draft.data.id,implementationPath:decision.path,pathReason:decision.reason,plainSummary,expectedValue:businessValue,approvalQuestion:"Should HD SEO prepare this change for a validated preview?"});}
