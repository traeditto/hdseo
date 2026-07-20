import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError,logEvent,logServerError,safeError } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { requireAdminDb } from "@/lib/automation/control-plane";
import { crawlSite } from "@/lib/crawler/site-crawler";
import { loadGoogleConnection,googleAccess } from "@/lib/google/connection";
import { inspectSearchConsoleUrl,listSearchConsoleSitemaps,querySearchAnalytics } from "@/lib/google/search-console";
import { importSearchConsoleDiscovery } from "@/lib/seo/autonomous-discovery";
import {settleTrialCrawl} from "@/lib/trials/crawl-entitlement";

type EvidenceJob={id:string;job_type:string;agency_id:string;client_organization_id:string|null;project_id:string|null;website_id:string|null;source_connection_id:string|null;payload:Record<string,unknown>;attempt_count:number;max_attempts:number;fencing_token:string|null};
type RunContext={db:SupabaseClient;job:EvidenceJob;runId:string};

const isoDate=(date:Date)=>date.toISOString().slice(0,10);
const safeInt=(value:unknown,fallback:number)=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):fallback;

async function heartbeat(component:string,status:"healthy"|"degraded"|"failed",metadata:Record<string,unknown>={}){
  try{await requireAdminDb().from("system_heartbeats").upsert({component,status,worker_id:`evidence:${process.env.VERCEL_REGION??"local"}`,last_seen_at:new Date().toISOString(),metadata,updated_at:new Date().toISOString()},{onConflict:"component"});}catch{/* migration may not be applied yet; the worker result still contains the failure */}
}

async function startRun(job:EvidenceJob,runType:"search_analytics"|"sitemaps"|"url_inspection"|"crawl"){
  if(!job.client_organization_id||!job.project_id)throw new ApiError("Evidence job is missing its tenant scope.",500,"DATABASE_BINDING_FAILED");
  const db=requireAdminDb(),created=await db.from("evidence_collection_runs").insert({agency_id:job.agency_id,client_organization_id:job.client_organization_id,project_id:job.project_id,source_connection_id:job.source_connection_id,website_id:job.website_id,run_type:runType,status:"running",started_at:new Date().toISOString(),metadata:{jobId:job.id}}).select("id").single();
  if(created.error||!created.data)throw new ApiError("The evidence collection run could not be recorded. Apply migration 0016 and retry.",500,"DATABASE_BINDING_FAILED");
  return{db,job,runId:created.data.id} satisfies RunContext;
}

async function finishRun(context:RunContext,status:"succeeded"|"failed",values:Record<string,unknown>={}){
  await context.db.from("evidence_collection_runs").update({status,completed_at:new Date().toISOString(),updated_at:new Date().toISOString(),...values}).eq("id",context.runId).eq("agency_id",context.job.agency_id);
}

function requireTenant(job:EvidenceJob){if(!job.client_organization_id||!job.project_id)throw new ApiError("Evidence job is missing its tenant scope.",500,"DATABASE_BINDING_FAILED");return{agencyId:job.agency_id,clientId:job.client_organization_id,projectId:job.project_id};}

async function searchAnalytics(job:EvidenceJob){
  const context=await startRun(job,"search_analytics"),tenant=requireTenant(job);
  try{
    const connection=await loadGoogleConnection(context.db,{agencyId:tenant.agencyId,clientId:tenant.clientId,projectId:tenant.projectId,connectionId:job.source_connection_id??undefined}),accessToken=await googleAccess(context.db,connection),property=connection.selected_resource;
    if(!property)throw new ApiError("Select a Search Console property before syncing evidence.",409,"PROPERTY_NOT_AUTHORIZED");
    const end=new Date(Date.now()-2*86_400_000),previous=connection.last_synced_at?new Date(connection.last_synced_at):new Date(Date.now()-30*86_400_000),start=new Date(Math.max(previous.getTime()-3*86_400_000,Date.now()-30*86_400_000));
    const rows:Array<Record<string,unknown>>=[];let startRow=0;
    for(let page=0;page<8;page++){
      const response=await querySearchAnalytics({accessToken,property,startDate:isoDate(start),endDate:isoDate(end),startRow,rowLimit:25_000}),batch=response.rows??[];
      for(const row of batch){const keys=row.keys??[];if(!keys[0]||!keys[2])continue;rows.push({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,query:keys[0],page_url:keys[1]??null,date:keys[2],device:keys[3]??"all",country:keys[4]??"all",clicks:Number(row.clicks??0),impressions:Number(row.impressions??0),ctr:row.ctr==null?null:Number(row.ctr),average_position:row.position==null?null:Number(row.position),source_connection_id:connection.id,captured_at:new Date().toISOString()});}
      if(batch.length<25_000)break;startRow+=batch.length;
    }
    if(rows.length){const written=await context.db.from("search_console_rows").upsert(rows,{onConflict:"project_id,date,query,page_url,device,country"});if(written.error)throw new ApiError("Search Console rows could not be stored.",500,"DATABASE_BINDING_FAILED");}
    const discovery=await importSearchConsoleDiscovery(context.db,{...tenant,requestedBy:"system"},Math.min(env.MAX_KEYWORDS_PER_RUN,250));
    const now=new Date().toISOString();await context.db.from("integration_connections").update({last_synced_at:now,last_verified_at:now,status:"active",metadata:{...connection.metadata,lastSearchAnalyticsRun:now,health:"ready",property},updated_at:now}).eq("id",connection.id).eq("agency_id",tenant.agencyId);
    await finishRun(context,"succeeded",{window_start:isoDate(start),window_end:isoDate(end),records_read:rows.length,records_written:rows.length,metadata:{property,discoveredKeywords:discovery.keywords}});await heartbeat("evidence", "healthy",{lastJob:"google.search_analytics",projectId:tenant.projectId,records:rows.length});return{records:rows.length,discoveredKeywords:discovery.keywords};
  }catch(error){const safe=safeError(error);await finishRun(context,"failed",{error_code:safe.body.error.code,error_message:safe.body.error.message});await heartbeat("evidence","degraded",{lastJob:"google.search_analytics",errorCode:safe.body.error.code});throw error;}
}

async function sitemaps(job:EvidenceJob){
  const context=await startRun(job,"sitemaps"),tenant=requireTenant(job);
  try{
    const connection=await loadGoogleConnection(context.db,{agencyId:tenant.agencyId,clientId:tenant.clientId,projectId:tenant.projectId,connectionId:job.source_connection_id??undefined}),accessToken=await googleAccess(context.db,connection),property=connection.selected_resource;if(!property)throw new ApiError("Select a Search Console property before syncing sitemaps.",409,"PROPERTY_NOT_AUTHORIZED");
    const result=await listSearchConsoleSitemaps(accessToken,property),now=new Date().toISOString(),sitemapRows=Array.isArray(result.sitemap)?result.sitemap:[];
    const saved=await context.db.from("integration_connections").update({last_synced_at:now,last_verified_at:now,metadata:{...connection.metadata,sitemaps:sitemapRows,lastSitemapSync:now,health:"ready"},updated_at:now}).eq("id",connection.id).eq("agency_id",tenant.agencyId);if(saved.error)throw new ApiError("Search Console sitemaps could not be stored.",500,"DATABASE_BINDING_FAILED");
    await finishRun(context,"succeeded",{records_read:sitemapRows.length,records_written:sitemapRows.length,metadata:{property}});await heartbeat("evidence","healthy",{lastJob:"google.sitemaps",projectId:tenant.projectId,records:sitemapRows.length});return{records:sitemapRows.length};
  }catch(error){const safe=safeError(error);await finishRun(context,"failed",{error_code:safe.body.error.code,error_message:safe.body.error.message});throw error;}
}

async function urlInspection(job:EvidenceJob){
  const context=await startRun(job,"url_inspection"),tenant=requireTenant(job);
  try{
    const connection=await loadGoogleConnection(context.db,{agencyId:tenant.agencyId,clientId:tenant.clientId,projectId:tenant.projectId,connectionId:job.source_connection_id??undefined}),accessToken=await googleAccess(context.db,connection),property=connection.selected_resource;if(!property)throw new ApiError("Select a Search Console property before inspecting URLs.",409,"PROPERTY_NOT_AUTHORIZED");
    const policy=await context.db.from("project_evidence_policies").select("url_inspection_limit").eq("project_id",tenant.projectId).maybeSingle(),limit=Math.min(100,safeInt(job.payload.urlInspectionLimit,policy.data?.url_inspection_limit??10)),pages=await context.db.from("search_console_rows").select("page_url").eq("project_id",tenant.projectId).not("page_url","is",null).order("clicks",{ascending:false}).limit(Math.max(20,limit*5)),urls=[...new Set((pages.data??[]).map(row=>row.page_url).filter((url):url is string=>typeof url==="string"&&url.startsWith("http")))].slice(0,limit);
    const rows=[];for(const url of urls){const response=await inspectSearchConsoleUrl(accessToken,property,url),inspection=response.inspectionResult??{},indexStatus=(inspection.indexStatusResult as Record<string,unknown>|undefined)??{},saved=await context.db.from("url_inspection_snapshots").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,url,index_status:typeof indexStatus.verdict==="string"?indexStatus.verdict:null,google_canonical:typeof indexStatus.googleCanonical==="string"?indexStatus.googleCanonical:null,user_canonical:typeof indexStatus.userCanonical==="string"?indexStatus.userCanonical:null,indexing_allowed:typeof indexStatus.indexingState==="string"?indexStatus.indexingState==="INDEXING_ALLOWED":null,crawl_state:typeof indexStatus.pageFetchState==="string"?indexStatus.pageFetchState:null,last_crawl_at:typeof indexStatus.lastCrawlTime==="string"?indexStatus.lastCrawlTime:null,referring_sitemaps:indexStatus.sitemap??[],raw_response:response,captured_at:new Date().toISOString()});if(saved.error)throw new ApiError("URL Inspection evidence could not be stored.",500,"DATABASE_BINDING_FAILED");rows.push(url);}
    await finishRun(context,"succeeded",{records_read:urls.length,records_written:rows.length,metadata:{property}});await heartbeat("evidence","healthy",{lastJob:"google.url_inspection",projectId:tenant.projectId,records:rows.length});return{records:rows.length};
  }catch(error){const safe=safeError(error);await finishRun(context,"failed",{error_code:safe.body.error.code,error_message:safe.body.error.message});throw error;}
}

async function crawler(job:EvidenceJob){
  const context=await startRun(job,"crawl"),tenant=requireTenant(job);
  try{
    const website=await context.db.from("websites").select("id,site_url").eq("id",job.website_id).eq("agency_id",tenant.agencyId).eq("client_organization_id",tenant.clientId).eq("project_id",tenant.projectId).maybeSingle();if(!website.data)throw new ApiError("The website for this crawl no longer exists.",404,"NOT_FOUND");
    const policy=await context.db.from("project_evidence_policies").select("max_crawl_pages").eq("project_id",tenant.projectId).maybeSingle(),pages=await crawlSite({siteUrl:website.data.site_url,maxPages:Math.min(env.MAX_CRAWL_PAGES,safeInt(job.payload.maxPages,policy.data?.max_crawl_pages??env.MAX_CRAWL_PAGES))}),rows=pages.pages.map(page=>({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,url:page.url,final_url:page.finalUrl,http_status:page.httpStatus,title:page.title,meta_description:page.metaDescription,h1:page.h1,headings:page.headings,internal_links:page.internalLinks,schema_types:page.schemaTypes,schema_json_ld_valid:page.schemaJsonLdValid,assigned_keywords:[],canonical:page.canonical,robots_directives:page.robotsDirectives,sitemap_member:page.sitemapMember,indexable:page.indexable,content_hash:page.contentHash,response_bytes:page.responseBytes,crawl_depth:page.depth,crawl_run_id:context.runId,captured_at:new Date().toISOString()}));
    if(rows.length){const written=await context.db.from("seo_page_snapshots").upsert(rows,{onConflict:"project_id,url,crawl_run_id"});if(written.error)throw new ApiError("Crawl page evidence could not be stored.",500,"DATABASE_BINDING_FAILED");}
    await finishRun(context,"succeeded",{records_read:pages.pages.length,records_written:rows.length,metadata:{siteUrl:pages.siteUrl,canonicalDomain:pages.canonicalDomain,sitemapUrls:pages.sitemapUrls.length}});await heartbeat("crawler","healthy",{projectId:tenant.projectId,pages:pages.pages.length});return{pages:pages.pages.length};
  }catch(error){const safe=safeError(error);await finishRun(context,"failed",{error_code:safe.body.error.code,error_message:safe.body.error.message});await heartbeat("crawler","degraded",{projectId:tenant.projectId,errorCode:safe.body.error.code});throw error;}
}

const handlers:Record<string,(job:EvidenceJob)=>Promise<unknown>>={"google.search_analytics":searchAnalytics,"google.sitemaps":sitemaps,"google.url_inspection":urlInspection,"crawler.crawl":crawler};

async function resumeWaitingCampaigns(db:SupabaseClient,projectId:string){
  const pending=await db.from("background_jobs").select("id",{count:"exact",head:true}).eq("queue","evidence").eq("project_id",projectId).in("status",["queued","running","retry_scheduled"]);if((pending.count??0)>0)return;
  await db.from("seo_campaign_jobs").update({status:"queued",next_attempt_at:new Date().toISOString(),heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("project_id",projectId).eq("status","awaiting_evidence_refresh");
}

export async function processEvidenceBatch(size=env.AUTOMATION_JOB_BATCH_SIZE,workerId=`evidence:${crypto.randomUUID()}`){
  const db=requireAdminDb(),claimed=await db.rpc("claim_background_jobs",{p_worker_id:workerId,p_batch_size:size,p_lock_seconds:300,p_queue:"evidence"});if(claimed.error)throw new ApiError("Evidence jobs could not be claimed. Apply migration 0016 and retry.",503,"DATABASE_BINDING_FAILED");const jobs=(claimed.data??[]) as EvidenceJob[],results=[];
  for(const job of jobs){const handler=handlers[job.job_type];try{if(!handler)throw new ApiError(`Unknown evidence job type: ${job.job_type}`,500,"OPERATION_FAILED");if(!job.fencing_token)throw new ApiError("The claimed evidence job has no fencing token.",500,"INVALID_STATE");const lease=await db.rpc("extend_background_job_lease",{p_job_id:job.id,p_worker_id:workerId,p_fencing_token:job.fencing_token,p_lock_seconds:300});if(lease.error||!lease.data)throw new ApiError("The evidence worker lost its job lease.",409,"CONFLICT");const output=await handler(job);const completed=await db.from("background_jobs").update({status:"succeeded",completed_at:new Date().toISOString(),worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token).select("id").maybeSingle();if(!completed.data){results.push({jobId:job.id,status:"stale_worker"});continue;}if(job.job_type==="crawler.crawl")await settleTrialCrawl(db,{jobId:job.id,status:"succeeded"});if(job.project_id)await resumeWaitingCampaigns(db,job.project_id);results.push({jobId:job.id,status:"succeeded",output});logEvent("evidence_job_completed",{jobId:job.id,agencyId:job.agency_id,projectId:job.project_id??undefined,stage:job.job_type});}catch(error){const safe=safeError(error),retryable=(safe.status===429||safe.status>=500)&&job.attempt_count<job.max_attempts,delay=Math.min(900_000,15_000*2**Math.max(0,job.attempt_count-1))+Math.floor(Math.random()*5000),status=retryable?"retry_scheduled":job.attempt_count>=job.max_attempts?"dead_letter":"failed";await db.from("background_jobs").update({status,available_at:new Date(Date.now()+delay).toISOString(),last_error_code:safe.body.error.code,last_error_message:safe.body.error.message,worker_id:null,locked_at:null,lock_expires_at:null,fencing_token:null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("worker_id",workerId).eq("fencing_token",job.fencing_token);if(job.job_type==="crawler.crawl"&&status!=="retry_scheduled")await settleTrialCrawl(db,{jobId:job.id,status:"failed",errorCode:safe.body.error.code});const referenceId=logServerError("evidence_job_failed",error,{jobId:job.id,agencyId:job.agency_id,projectId:job.project_id??undefined,operation:job.job_type,errorCode:safe.body.error.code});results.push({jobId:job.id,status,error:safe.body.error,referenceId});}}
  return{claimed:jobs.length,results};
}
