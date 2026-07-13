import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasDataForSeoConfig, hasGitHubConfig, hasSupabaseAdminConfig, env } from "@/lib/config/env";

const requiredTables = ["agencies","agency_members","client_organizations","seo_projects","seo_keywords","organic_ranking_snapshots","keyword_metric_snapshots","seo_opportunities","seo_campaign_jobs","repository_connections","seo_executions","seo_monitoring_plans"];

export async function systemReadiness(projectId?: string) {
  const db = createSupabaseAdminClient(), missingTables: string[] = [], warnings: string[] = [], evidence = { keywords:0, metrics:0, rankings:0, pages:0, competitors:0, audits:0 };
  if (db) for (const table of requiredTables) { const probe = await db.from(table).select("*", { head: true, count: "exact" }).limit(0); if (probe.error && /schema cache|does not exist|PGRST205/i.test(`${probe.error.code} ${probe.error.message}`)) missingTables.push(table); }
  if (db && projectId && !missingTables.length) {
    const counts = await Promise.all([
      db.from("seo_keywords").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("keyword_metric_snapshots").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
      db.from("organic_ranking_snapshots").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("seo_page_snapshots").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
      db.from("competitor_domains").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("site_audits").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
    ]);
    [evidence.keywords,evidence.metrics,evidence.rankings,evidence.pages,evidence.competitors,evidence.audits] = counts.map((result) => result.count ?? 0);
  }
  if (!hasDataForSeoConfig) warnings.push("DataForSEO is not configured.");
  if (!hasGitHubConfig) warnings.push("GitHub App execution is not configured.");
  if (!env.CRON_SECRET) warnings.push("Background scheduling is not configured.");
  return { ready: hasSupabaseAdminConfig && missingTables.length === 0, configuration: { supabase: hasSupabaseAdminConfig, dataForSeo: hasDataForSeoConfig, github: hasGitHubConfig, scheduler: Boolean(env.CRON_SECRET), vercel: Boolean(env.VERCEL_PROJECT_ID && env.VERCEL_WEBHOOK_SECRET) }, missingTables, evidence, warnings };
}
