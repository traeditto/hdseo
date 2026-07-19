import "server-only";

/* Database types are regenerated after migration 0024 is applied. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";

export type OutcomeTenant={agencyId:string;clientId:string;projectId:string;userId:string|null};
const now=()=>new Date().toISOString();
const scope=(query:any,tenant:Omit<OutcomeTenant,"userId">)=>query.eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId);
const amount=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:Number(value)||0;
const must=<T=any>(result:{data:unknown;error:unknown},message:string):T=>{if(result.error||result.data==null)throw new ApiError(message,500,"DATABASE_BINDING_FAILED");return result.data as T};

export async function outcomesSnapshot(db:SupabaseClient,tenant:Omit<OutcomeTenant,"userId">){
  const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);
  const[budget,allocations,transactions,metrics,leads,profiles,reviews,citations,outreach,connections,syncs]=await Promise.all([
    scope(db.from("project_budget_accounts").select("*"),tenant).maybeSingle(),
    scope(db.from("project_budget_allocations").select("*"),tenant).order("category"),
    scope(db.from("project_budget_transactions").select("*"),tenant).gte("occurred_at",start.toISOString()).order("occurred_at",{ascending:false}).limit(250),
    scope(db.from("analytics_daily_metrics").select("*"),tenant).gte("metric_date",new Date(Date.now()-90*86400000).toISOString().slice(0,10)).order("metric_date",{ascending:false}).limit(5000),
    scope(db.from("seo_leads").select("id,source,landing_page_url,query,lead_type,status,qualified,revenue,gross_profit,occurred_at,metadata"),tenant).gte("occurred_at",new Date(Date.now()-90*86400000).toISOString()).order("occurred_at",{ascending:false}).limit(500),
    scope(db.from("local_business_profiles").select("*"),tenant).order("updated_at",{ascending:false}),
    scope(db.from("local_reviews").select("*"),tenant).order("review_created_at",{ascending:false}).limit(250),
    scope(db.from("citation_listings").select("*"),tenant).order("updated_at",{ascending:false}).limit(250),
    scope(db.from("authority_outreach_actions").select("*"),tenant).order("created_at",{ascending:false}).limit(250),
    scope(db.from("integration_connections").select("id,provider,status,selected_resource,last_synced_at,last_verified_at,metadata"),tenant).in("provider",["google_search_console","google_analytics","google_business_profile","callrail","hubspot","generic_crm"]),
    scope(db.from("provider_sync_runs").select("id,provider,operation,status,records_read,records_written,error_code,started_at,completed_at"),tenant).order("started_at",{ascending:false}).limit(30)
  ]);
  for(const result of[budget,allocations,transactions,metrics,profiles,reviews,citations,outreach,syncs])if(result.error)throw new ApiError("Apply migration 0024 to enable outcomes, attribution, budgets, and local operations.",503,"DATABASE_BINDING_FAILED");
  const transactionRows=transactions.data??[],metricRows=metrics.data??[],leadRows=leads.data??[],reviewRows=reviews.data??[],citationRows=citations.data??[];
  const spent=transactionRows.filter((row:any)=>row.transaction_type==="actual"&&row.approval_status!=="rejected").reduce((sum:number,row:any)=>sum+amount(row.amount),0);
  const committed=transactionRows.filter((row:any)=>row.transaction_type==="commitment"&&row.approval_status!=="rejected").reduce((sum:number,row:any)=>sum+amount(row.amount),0);
  const revenue=leadRows.reduce((sum:number,row:any)=>sum+amount(row.revenue),0),grossProfit=leadRows.reduce((sum:number,row:any)=>sum+amount(row.gross_profit),0);
  const sessions=metricRows.reduce((sum:number,row:any)=>sum+amount(row.organic_sessions||row.sessions),0),conversions=metricRows.reduce((sum:number,row:any)=>sum+amount(row.conversions),0);
  const ratingCount=reviewRows.filter((row:any)=>row.star_rating!=null).length,averageRating=ratingCount?reviewRows.reduce((sum:number,row:any)=>sum+amount(row.star_rating),0)/ratingCount:null;
  return{budget:budget.data??null,allocations:allocations.data??[],transactions:transactionRows,metrics:metricRows,leads:leadRows,profiles:profiles.data??[],reviews:reviewRows,citations:citationRows,outreach:outreach.data??[],connections:connections.data??[],syncs:syncs.data??[],summary:{spent:+spent.toFixed(2),committed:+committed.toFixed(2),remaining:budget.data?+Math.max(0,amount(budget.data.monthly_limit)-spent-committed).toFixed(2):null,organicSessions:sessions,conversions,leads:leadRows.length,qualifiedLeads:leadRows.filter((row:any)=>row.qualified).length,bookedRevenue:+revenue.toFixed(2),grossProfit:+grossProfit.toFixed(2),returnOnSpend:spent>0?+(grossProfit/spent).toFixed(2):null,averageRating:averageRating==null?null:+averageRating.toFixed(2),unansweredReviews:reviewRows.filter((row:any)=>row.response_status==="unanswered").length,citationIssues:citationRows.filter((row:any)=>["needs_claim","needs_correction"].includes(row.status)).length}};
}

export async function configureBudget(db:SupabaseClient,tenant:OutcomeTenant,input:{monthlyLimit:number;warningPercent:number;hardStop:boolean;allocations:Array<{category:string;monthlyAmount:number;approvalThreshold:number}>}){
  const account=must<any>(await db.from("project_budget_accounts").upsert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,monthly_limit:input.monthlyLimit,warning_percent:input.warningPercent,hard_stop:input.hardStop,status:"active",updated_at:now()},{onConflict:"project_id"}).select("id").single(),"The project budget could not be saved.");
  const total=input.allocations.reduce((sum,item)=>sum+item.monthlyAmount,0);if(total>input.monthlyLimit+.005)throw new ApiError("Budget allocations cannot exceed the monthly limit.",400,"VALIDATION_ERROR");
  if(input.allocations.length){const saved=await db.from("project_budget_allocations").upsert(input.allocations.map(item=>({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,budget_account_id:account.id,category:item.category,monthly_amount:item.monthlyAmount,approval_threshold:item.approvalThreshold,updated_at:now()})),{onConflict:"project_id,category"});if(saved.error)throw new ApiError("Budget allocations could not be saved.",500,"DATABASE_BINDING_FAILED");}
  return account;
}

export async function recordBudgetTransaction(db:SupabaseClient,tenant:OutcomeTenant,input:{category:string;transactionType:string;provider:string;description:string;amount:number;externalId?:string;idempotencyKey:string;metadata?:Record<string,unknown>}){
  const account=await scope(db.from("project_budget_accounts").select("id,monthly_limit,hard_stop"),tenant).maybeSingle();if(!account.data)throw new ApiError("Configure this project's monthly SEO budget before recording spend.",409,"CONFLICT");
  const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);const existing=await scope(db.from("project_budget_transactions").select("amount,transaction_type,approval_status"),tenant).gte("occurred_at",start.toISOString());
  const consumed=(existing.data??[]).filter((row:any)=>["actual","commitment"].includes(row.transaction_type)&&row.approval_status!=="rejected").reduce((sum:number,row:any)=>sum+amount(row.amount),0);
  if(account.data.hard_stop&&input.transactionType!=="credit"&&consumed+input.amount>amount(account.data.monthly_limit))throw new ApiError("This transaction would exceed the project's hard monthly SEO spending limit.",409,"CONFLICT");
  return must(await db.from("project_budget_transactions").upsert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,budget_account_id:account.data.id,category:input.category,transaction_type:input.transactionType,provider:input.provider,description:input.description,amount:input.amount,external_id:input.externalId??null,approval_status:"not_required",idempotency_key:input.idempotencyKey,metadata:input.metadata??{}},{onConflict:"agency_id,idempotency_key"}).select("id").single(),"SEO spending could not be recorded.");
}

export async function ingestLead(db:SupabaseClient,tenant:OutcomeTenant,input:{source:string;externalId:string;landingPageUrl?:string;query?:string;leadType:string;status:string;qualified?:boolean;revenue?:number;grossProfit?:number;occurredAt:string;metadata?:Record<string,unknown>;touchpoints?:Array<Record<string,unknown>>}){
  const lead=must<any>(await db.from("seo_leads").upsert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,source:input.source,external_id:input.externalId,landing_page_url:input.landingPageUrl??null,query:input.query??null,lead_type:input.leadType,status:input.status,qualified:input.qualified??null,revenue:input.revenue??null,gross_profit:input.grossProfit??null,occurred_at:input.occurredAt,metadata:input.metadata??{},updated_at:now()},{onConflict:"project_id,source,external_id"}).select("id").single(),"The lead outcome could not be saved.");
  if(input.touchpoints?.length){const saved=await db.from("attribution_touchpoints").insert(input.touchpoints.map((item,index)=>({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,lead_id:lead.id,touchpoint_type:String(item.touchpointType??"visit"),channel:String(item.channel??"unknown"),source:item.source??null,medium:item.medium??null,campaign:item.campaign??null,query:item.query??null,landing_page_url:item.landingPageUrl??null,referrer_url:item.referrerUrl??null,occurred_at:String(item.occurredAt??input.occurredAt),attribution_weight:amount(item.attributionWeight??(index===input.touchpoints!.length-1?1:0)),model:String(item.model??"evidence_only"),evidence:item.evidence??{}})));if(saved.error)throw new ApiError("Lead attribution evidence could not be saved.",500,"DATABASE_BINDING_FAILED");}
  return lead;
}

export async function saveCitation(db:SupabaseClient,tenant:OutcomeTenant,input:any){return must(await db.from("citation_listings").upsert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,provider:input.provider,directory_name:input.directoryName,listing_url:input.listingUrl??null,name:input.name??null,address:input.address??null,phone:input.phone??null,website_url:input.websiteUrl??null,nap_consistent:input.napConsistent??null,claimed:input.claimed??null,status:input.status,issue_codes:input.issueCodes??[],evidence:input.evidence??{},last_checked_at:now(),updated_at:now()},{onConflict:"project_id,provider,directory_name"}).select("id").single(),"Citation evidence could not be saved.");}

export async function draftAuthorityOutreach(db:SupabaseClient,tenant:OutcomeTenant,input:any){
  const forbidden=/\b(buy|purchase|exchange|reciprocal|guaranteed)\b.{0,24}\b(link|backlink|dofollow)\b/i;if(forbidden.test(`${input.subject} ${input.message}`))throw new ApiError("Paid, reciprocal, or guaranteed-link outreach is not permitted.",400,"UNSAFE_AUTHORITY_TACTIC");
  return must(await db.from("authority_outreach_actions").upsert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,authority_opportunity_id:input.authorityOpportunityId??null,contact_name:input.contactName??null,contact_email:input.contactEmail??null,organization:input.organization??null,target_url:input.targetUrl??null,outreach_type:input.outreachType,subject:input.subject,message:input.message,status:"awaiting_approval",risk_level:"high",estimated_cost:input.estimatedCost??0,evidence:input.evidence??{},idempotency_key:input.idempotencyKey,created_by:tenant.userId},{onConflict:"agency_id,idempotency_key"}).select("id,status").single(),"Authority outreach could not be drafted.");
}
