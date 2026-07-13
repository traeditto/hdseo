import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasDataForSeoConfig, hasGitHubConfig, hasSupabaseAdminConfig, env } from "@/lib/config/env";

const requiredTables = ["agencies","agency_members","client_organizations","client_members","seo_projects","websites","seo_services","seo_locations","seo_keywords","organic_ranking_snapshots","keyword_metric_snapshots","seo_opportunities","seo_campaign_jobs","implementation_packages","seo_task_approvals","implementation_verifications","proof_of_work_events","seo_monitoring_plans"];

export async function systemReadiness(projectId?: string) {
  const db = createSupabaseAdminClient(), missingTables: string[] = [], warnings: string[] = [], blockers: string[] = [];
  const evidenceStatus = { services:0, locations:0, keywords:0, keywordMetrics:0, rankingSnapshots:0, pages:0, audits:0, mapsSnapshots:0, competitors:0, searchConsoleRows:0 };
  if (db) for (const table of requiredTables) { const probe = await db.from(table).select("*", { head: true, count: "exact" }).limit(0); if (probe.error && /schema cache|does not exist|PGRST205/i.test(`${probe.error.code} ${probe.error.message}`)) missingTables.push(table); }
  let projectFound = false;
  if (db && projectId && !missingTables.length) {
    const project = await db.from("seo_projects").select("id").eq("id", projectId).maybeSingle();
    projectFound = Boolean(project.data);
    const counts = await Promise.all([
      db.from("seo_services").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("seo_locations").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
      db.from("seo_keywords").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("keyword_metric_snapshots").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
      db.from("organic_ranking_snapshots").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("seo_page_snapshots").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
      db.from("site_audits").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("maps_rank_snapshots").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
      db.from("competitor_domains").select("id",{head:true,count:"exact"}).eq("project_id",projectId), db.from("search_console_rows").select("id",{head:true,count:"exact"}).eq("project_id",projectId),
    ]);
    [evidenceStatus.services,evidenceStatus.locations,evidenceStatus.keywords,evidenceStatus.keywordMetrics,evidenceStatus.rankingSnapshots,evidenceStatus.pages,evidenceStatus.audits,evidenceStatus.mapsSnapshots,evidenceStatus.competitors,evidenceStatus.searchConsoleRows] = counts.map((result) => result.count ?? 0);
  }
  if (!hasDataForSeoConfig) warnings.push("DataForSEO is not configured.");
  if (!hasGitHubConfig) warnings.push("GitHub App execution is not configured.");
  if (!env.CRON_SECRET) warnings.push("Background scheduling is not configured.");
  if (!hasSupabaseAdminConfig) blockers.push("Supabase service configuration is missing.");
  if (missingTables.length) blockers.push(`Required database migrations are missing: ${missingTables.join(", ")}.`);
  if (projectId && !projectFound) blockers.push("The selected project was not found.");
  if (projectFound && evidenceStatus.keywords === 0) blockers.push("Add at least one real project keyword.");
  if (projectFound && evidenceStatus.rankingSnapshots === 0) blockers.push("Collect an approved ranking snapshot before scoring opportunities.");
  const ready = blockers.length === 0;
  return { ready, projectFound, databaseReady: hasSupabaseAdminConfig && missingTables.length === 0, providerStatus: { dataForSeo: hasDataForSeoConfig, searchConsole: evidenceStatus.searchConsoleRows > 0, scheduler: Boolean(env.CRON_SECRET) }, evidenceStatus, blockers, warnings, recommendedNextStep: ready ? "Review the highest eligible opportunity." : blockers[0], configuration: { supabase: hasSupabaseAdminConfig, dataForSeo: hasDataForSeoConfig, github: hasGitHubConfig, scheduler: Boolean(env.CRON_SECRET), vercel: Boolean(env.VERCEL_PROJECT_ID && env.VERCEL_WEBHOOK_SECRET) }, missingTables, evidence: { keywords:evidenceStatus.keywords,metrics:evidenceStatus.keywordMetrics,rankings:evidenceStatus.rankingSnapshots,pages:evidenceStatus.pages,competitors:evidenceStatus.competitors,audits:evidenceStatus.audits } };
}
