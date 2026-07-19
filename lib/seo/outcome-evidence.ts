import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type Tenant={agencyId:string;clientId:string;projectId:string};
export type OutcomeTotals={clicks:number;impressions:number;organicSessions:number;conversions:number;leads:number;qualifiedLeads:number;revenue:number;grossProfit:number;spend:number};
const empty=():OutcomeTotals=>({clicks:0,impressions:0,organicSessions:0,conversions:0,leads:0,qualifiedLeads:0,revenue:0,grossProfit:0,spend:0});
const n=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const path=(value:unknown)=>{if(typeof value!=="string"||!value)return"";try{return new URL(value,"https://placeholder.invalid").pathname.replace(/\/$/,"")||"/"}catch{return value.replace(/\/$/,"")||"/"}};
const date=(value:Date)=>value.toISOString().slice(0,10);

export async function collectOutcomeEvidence(db:SupabaseClient,tenant:Tenant,input:{targetUrl:string;executionId:string;from:Date;to:Date}){
  const fromDate=date(input.from),toDate=date(input.to),fromTime=input.from.toISOString(),toTime=input.to.toISOString(),targetPath=path(input.targetUrl),[gsc,analytics,leads,transactions]=await Promise.all([
    db.from("search_console_rows").select("page_url,clicks,impressions").eq("project_id",tenant.projectId).gte("date",fromDate).lte("date",toDate).limit(10000),
    db.from("analytics_daily_metrics").select("landing_page,organic_sessions,sessions,conversions,revenue,gross_profit").eq("project_id",tenant.projectId).gte("metric_date",fromDate).lte("metric_date",toDate).limit(10000),
    db.from("seo_leads").select("landing_page_url,qualified,revenue,gross_profit").eq("project_id",tenant.projectId).gte("occurred_at",fromTime).lte("occurred_at",toTime).limit(5000),
    db.from("project_budget_transactions").select("amount,transaction_type,approval_status,source_id").eq("project_id",tenant.projectId).gte("occurred_at",fromTime).lte("occurred_at",toTime).limit(5000),
  ]),project=empty(),target=empty();
  for(const row of gsc.data??[]){project.clicks+=n(row.clicks);project.impressions+=n(row.impressions);if(path(row.page_url)===targetPath){target.clicks+=n(row.clicks);target.impressions+=n(row.impressions);}}
  for(const row of analytics.data??[]){const values={organicSessions:n(row.organic_sessions??row.sessions),conversions:n(row.conversions),revenue:n(row.revenue),grossProfit:n(row.gross_profit)};for(const key of Object.keys(values) as Array<keyof typeof values>)project[key]+=values[key];if(path(row.landing_page)===targetPath)for(const key of Object.keys(values) as Array<keyof typeof values>)target[key]+=values[key];}
  for(const row of leads.data??[]){project.leads++;if(row.qualified)project.qualifiedLeads++;project.revenue+=n(row.revenue);project.grossProfit+=n(row.gross_profit);if(path(row.landing_page_url)===targetPath){target.leads++;if(row.qualified)target.qualifiedLeads++;target.revenue+=n(row.revenue);target.grossProfit+=n(row.gross_profit);}}
  for(const row of transactions.data??[]){if(row.approval_status==="rejected"||!["actual","commitment"].includes(String(row.transaction_type)))continue;project.spend+=n(row.amount);if(row.source_id===input.executionId)target.spend+=n(row.amount);}
  const days=Math.max(1,Math.ceil((input.to.getTime()-input.from.getTime())/86_400_000)+1),hasTargetEvidence=target.impressions>0||target.organicSessions>0||target.leads>0;
  return{from:fromTime,to:toTime,days,targetUrl:input.targetUrl,targetPath,target,project,comparisonScope:hasTargetEvidence?"target":"project",selected:hasTargetEvidence?target:project};
}

export function scaleOutcomeBaseline(evidence:{days:number;selected:OutcomeTotals},days:number){const factor=Math.max(1,days)/Math.max(1,evidence.days);return Object.fromEntries(Object.entries(evidence.selected).map(([key,value])=>[key,+((value as number)*factor).toFixed(2)])) as unknown as OutcomeTotals;}
