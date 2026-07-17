import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/config/env";
import { enqueueEvidenceJob } from "./queue";

type Tenant={agencyId:string;clientId:string;projectId:string};
type EvidenceName="searchConsole"|"pages"|"rankings"|"metrics";
type Item={latestAt:string|null;maxAgeHours:number;fresh:boolean;required:boolean};

const hoursAgo=(hours:number)=>Date.now()-hours*3_600_000;
function item(latestAt:string|null,maxAgeHours:number,required=true):Item{return{latestAt,maxAgeHours,required,fresh:!required||Boolean(latestAt&&new Date(latestAt).getTime()>=hoursAgo(maxAgeHours))};}
async function latest(db:SupabaseClient,table:string,column:string,projectId:string){const result=await db.from(table).select(column).eq("project_id",projectId).order(column,{ascending:false}).limit(1).maybeSingle();const value=(result.data as Record<string,unknown>|null)?.[column];return typeof value==="string"?value:null;}

export async function evidenceFreshness(db:SupabaseClient,tenant:Tenant){
  const [policy,connection,website,searchConsoleAt,pagesAt,rankingsAt,metricsAt]=await Promise.all([
    db.from("project_evidence_policies").select("search_console_max_age_hours,page_snapshot_max_age_hours,ranking_max_age_hours,keyword_metric_max_age_hours,max_crawl_pages,url_inspection_limit").eq("project_id",tenant.projectId).eq("agency_id",tenant.agencyId).maybeSingle(),
    db.from("integration_connections").select("id,status,selected_resource").eq("project_id",tenant.projectId).eq("agency_id",tenant.agencyId).eq("provider","google_search_console").eq("status","active").maybeSingle(),
    db.from("websites").select("id,status").eq("project_id",tenant.projectId).eq("agency_id",tenant.agencyId).eq("is_primary",true).limit(1).maybeSingle(),
    latest(db,"search_console_rows","captured_at",tenant.projectId),latest(db,"seo_page_snapshots","captured_at",tenant.projectId),latest(db,"organic_ranking_snapshots","collected_at",tenant.projectId),latest(db,"keyword_metric_snapshots","captured_at",tenant.projectId),
  ]);
  const config={searchConsoleMaxAgeHours:policy.data?.search_console_max_age_hours??72,pageMaxAgeHours:policy.data?.page_snapshot_max_age_hours??168,rankingMaxAgeHours:policy.data?.ranking_max_age_hours??336,metricMaxAgeHours:policy.data?.keyword_metric_max_age_hours??720,maxCrawlPages:Math.min(env.MAX_CRAWL_PAGES,policy.data?.max_crawl_pages??env.MAX_CRAWL_PAGES),urlInspectionLimit:policy.data?.url_inspection_limit??10};
  const items:Record<EvidenceName,Item>={searchConsole:item(searchConsoleAt,config.searchConsoleMaxAgeHours,Boolean(connection.data?.selected_resource)),pages:item(pagesAt,config.pageMaxAgeHours,Boolean(website.data)),rankings:item(rankingsAt,config.rankingMaxAgeHours,true),metrics:item(metricsAt,config.metricMaxAgeHours,true)};
  const stale=(Object.entries(items) as Array<[EvidenceName,Item]>).filter(([,value])=>value.required&&!value.fresh).map(([name])=>name);
  return{ready:stale.length===0,stale,items,config,connection:connection.data??null,website:website.data??null};
}

export async function queueStaleEvidence(db:SupabaseClient,tenant:Tenant,freshness:Awaited<ReturnType<typeof evidenceFreshness>>){
  const bucket=new Date().toISOString().slice(0,13),jobs:string[]=[];
  if(freshness.connection?.id&&freshness.connection.selected_resource&&freshness.stale.some(item=>["searchConsole","rankings","metrics"].includes(item))){
    jobs.push(await enqueueEvidenceJob(db,{...tenant,connectionId:freshness.connection.id,jobType:"google.search_analytics",idempotencyKey:`freshness:gsc:${tenant.projectId}:${bucket}`,priority:90}));
    jobs.push(await enqueueEvidenceJob(db,{...tenant,connectionId:freshness.connection.id,jobType:"google.url_inspection",idempotencyKey:`freshness:inspect:${tenant.projectId}:${bucket}`,priority:70}));
  }
  if(freshness.website?.id&&freshness.stale.includes("pages"))jobs.push(await enqueueEvidenceJob(db,{...tenant,websiteId:freshness.website.id,jobType:"crawler.crawl",payload:{maxPages:freshness.config.maxCrawlPages},idempotencyKey:`freshness:crawl:${tenant.projectId}:${bucket}`,priority:80}));
  return jobs;
}
