import "server-only";

import { env,hasCreativeModelConfig,hasDataForSeoConfig,hasGitHubConfig,hasGoogleSearchConsoleConfig,hasSupabaseAdminConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ReadinessState="ready"|"warning"|"blocked"|"unknown";
type Check={key:string;label:string;state:ReadinessState;detail:string;lastSeenAt?:string|null;count?:number|null};
const missingTable=(error:unknown)=>/schema cache|does not exist|PGRST205/i.test(String((error as {message?:string}|null)?.message??error));

export async function platformReadiness(){
  const db=createSupabaseAdminClient(),checks:Check[]=[];
  if(!db){checks.push({key:"database",label:"Supabase database",state:"blocked",detail:"Service-role configuration is missing."});return{ready:false,checks,queue:{queued:0,running:0,retryScheduled:0,deadLetter:0,oldestQueuedAt:null},heartbeats:[],lastSuccessfulAutomationAt:null};}
  const required=["agencies","seo_projects","background_jobs","integration_connections","evidence_collection_runs","project_evidence_policies","seo_page_snapshots","search_console_rows","agent_definitions","agent_work_items","agent_approvals","agent_memory","agent_tool_executions","business_proof_assets","seo_creative_specs","seo_creative_drafts","seo_leads"];
  for(const table of required){const result=await db.from(table).select("*",{head:true,count:"exact"}).limit(0);checks.push({key:`table:${table}`,label:`Database · ${table}`,state:result.error?(missingTable(result.error)?"blocked":"warning"):"ready",detail:result.error?(missingTable(result.error)?"Migration is not applied.":"The table could not be checked."):"Available",count:result.count??0});}
  const [queued,running,retry,dead,oldest,heartbeats,automation,github,vercel,gsc,websites]=await Promise.all([
    db.from("background_jobs").select("id",{head:true,count:"exact"}).eq("status","queued"),
    db.from("background_jobs").select("id",{head:true,count:"exact"}).eq("status","running"),
    db.from("background_jobs").select("id",{head:true,count:"exact"}).eq("status","retry_scheduled"),
    db.from("background_jobs").select("id",{head:true,count:"exact"}).eq("status","dead_letter"),
    db.from("background_jobs").select("created_at").in("status",["queued","retry_scheduled"]).order("created_at",{ascending:true}).limit(1).maybeSingle(),
    db.from("system_heartbeats").select("component,status,last_seen_at,metadata").order("last_seen_at",{ascending:false}),
    db.from("automation_runs").select("completed_at").eq("status","succeeded").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("github_installations").select("id",{head:true,count:"exact"}).eq("status","active"),
    db.from("vercel_connections").select("id",{head:true,count:"exact"}).eq("status","active"),
    db.from("integration_connections").select("id",{head:true,count:"exact"}).eq("provider","google_search_console").eq("status","active"),
    db.from("websites").select("id",{head:true,count:"exact"}).eq("status","active"),
  ]);
  const queue={queued:queued.count??0,running:running.count??0,retryScheduled:retry.count??0,deadLetter:dead.count??0,oldestQueuedAt:(oldest.data as {created_at?:string}|null)?.created_at??null};
  const heartbeatRows=(heartbeats.data??[]) as Array<{component:string;status:string;last_seen_at:string;metadata:Record<string,unknown>}>;
  const heartbeatMap=new Map(heartbeatRows.map(row=>[row.component,row]));
  const heartbeatState=(component:string)=>{const row=heartbeatMap.get(component);if(!row)return{state:"unknown" as ReadinessState,detail:"No scheduler heartbeat recorded yet.",lastSeenAt:null};const stale=Date.now()-new Date(row.last_seen_at).getTime()>15*60_000;return{state:row.status==="healthy"&&!stale?"ready" as ReadinessState:stale?"warning" as ReadinessState:"blocked" as ReadinessState,detail:stale?"Heartbeat is older than 15 minutes.":row.status==="healthy"?"Worker is reporting normally.":"Worker reported a degraded state.",lastSeenAt:row.last_seen_at};};
  const scheduler=heartbeatState("evidence");checks.push({key:"scheduler",label:"Background scheduler",state:env.CRON_SECRET?scheduler.state:"blocked",detail:env.CRON_SECRET?scheduler.detail:"CRON_SECRET is not configured.",lastSeenAt:scheduler.lastSeenAt});
  const crawler=heartbeatState("crawler");checks.push({key:"crawler",label:"Website crawler",state:crawler.state,detail:crawler.detail,lastSeenAt:crawler.lastSeenAt});
  const agents=heartbeatState("agents");checks.push({key:"agents",label:"Agent supervisor",state:env.CRON_SECRET?agents.state:"blocked",detail:env.CRON_SECRET?agents.detail:"CRON_SECRET is not configured.",lastSeenAt:agents.lastSeenAt});
  checks.push({key:"github",label:"GitHub App",state:hasGitHubConfig?"ready":"blocked",detail:hasGitHubConfig?`${github.count??0} active installation${github.count===1?"":"s"}.`:"GitHub App credentials are incomplete.",count:github.count??0});
  checks.push({key:"vercel",label:"Vercel deployment access",state:env.VERCEL_ACCESS_TOKEN?"ready":"blocked",detail:env.VERCEL_ACCESS_TOKEN?(env.VERCEL_WEBHOOK_SECRET?"Webhook and polling fallback configured.":"Polling fallback configured; webhook secret is not set."):"Vercel access token is not configured.",count:vercel.count??0});
  checks.push({key:"dataforseo",label:"DataForSEO",state:hasDataForSeoConfig?"ready":"warning",detail:hasDataForSeoConfig?"Provider credentials configured; paid actions remain confirmation-gated.":"Optional provider credentials are not configured."});
  checks.push({key:"search_console",label:"Google Search Console",state:hasGoogleSearchConsoleConfig?gsc.count?"ready":"warning":"blocked",detail:!hasGoogleSearchConsoleConfig?"OAuth credentials are not configured.":gsc.count?`${gsc.count} active project connection${gsc.count===1?"":"s"}.`:"OAuth is configured; connect a project property.",count:gsc.count??0});
  checks.push({key:"cms",label:"CMS / website connections",state:websites.count?"ready":"warning",detail:websites.count?`${websites.count} verified website connection${websites.count===1?"":"s"}.`:"No website has been verified yet.",count:websites.count??0});
  checks.push({key:"pagespeed",label:"PageSpeed / Lighthouse",state:env.PAGESPEED_API_KEY?"ready":"warning",detail:env.PAGESPEED_API_KEY?"API key configured.":"PageSpeed API key is not configured; deployment checks will be limited."});
  checks.push({key:"creative_model",label:"Creative generation model",state:hasCreativeModelConfig?"ready":"warning",detail:hasCreativeModelConfig?`${env.OPENAI_CREATIVE_MODEL} is configured; generation remains proof- and approval-gated.`:"OPENAI_API_KEY is not configured; proof collection and specifications work, but production copy generation is paused."});
  checks.push({key:"email",label:"Email delivery",state:env.RESEND_API_KEY&&env.RESEND_FROM_EMAIL?"ready":"warning",detail:env.RESEND_API_KEY&&env.RESEND_FROM_EMAIL?"Resend is configured.":"Resend is not configured; in-app notifications remain available."});
  checks.push({key:"billing",label:"Billing",state:env.STRIPE_SECRET_KEY?"ready":"warning",detail:env.STRIPE_SECRET_KEY?"Stripe secret is configured.":"Stripe is not configured; usage limits still apply."});
  checks.push({key:"queue",label:"Queue health",state:(queue.deadLetter>0?"warning":queue.retryScheduled>0?"warning":"ready"),detail:queue.deadLetter?`${queue.deadLetter} job${queue.deadLetter===1?"":"s"} in dead letter.`:queue.retryScheduled?`${queue.retryScheduled} job${queue.retryScheduled===1?"":"s"} waiting for retry.`:"No dead-letter jobs."});
  const lastSuccessfulAutomationAt=(automation.data as {completed_at?:string}|null)?.completed_at??null;
  checks.push({key:"automation",label:"End-to-end automation",state:lastSuccessfulAutomationAt?"ready":"unknown",detail:lastSuccessfulAutomationAt?"A successful automation run is recorded.":"No successful end-to-end run is recorded yet.",lastSeenAt:lastSuccessfulAutomationAt});
  return{ready:checks.every(check=>check.state!=="blocked"),checks,queue,heartbeats:heartbeatRows.map(row=>({component:row.component,status:row.status,lastSeenAt:row.last_seen_at})),lastSuccessfulAutomationAt,configuration:{database:hasSupabaseAdminConfig,cron:Boolean(env.CRON_SECRET)}};
}
