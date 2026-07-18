import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessKeywordServiceArea,
  buildServiceAreaPolicy,
  type ServiceAreaPolicy,
} from "./service-area";

export async function loadProjectServiceAreaPolicy(
  db: SupabaseClient,
  projectId: string,
  requestedMarket?: string | null,
): Promise<ServiceAreaPolicy> {
  const [project, locations, services] = await Promise.all([
    db.from("seo_projects").select("primary_market").eq("id", projectId).single(),
    db
      .from("seo_locations")
      .select("id,name,city,county,state,postal_code,country_code,priority")
      .eq("project_id", projectId)
      .eq("status", "active")
      .order("priority", { ascending: false }),
    db
      .from("seo_services")
      .select("id,name,priority")
      .eq("project_id", projectId)
      .eq("status", "active")
      .order("priority", { ascending: false }),
  ]);
  if (project.error) throw project.error;
  if (locations.error) throw locations.error;
  if (services.error) throw services.error;
  return buildServiceAreaPolicy({
    primaryMarket: project.data?.primary_market,
    requestedMarket,
    serviceAreas: (locations.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      county: row.county,
      state: row.state,
      postalCode: row.postal_code,
      countryCode: row.country_code,
      priority: row.priority,
    })),
    services: services.data ?? [],
  });
}

export async function quarantineOutOfAreaKeywords(
  db: SupabaseClient,
  projectId: string,
  policy: ServiceAreaPolicy,
) {
  if (!policy.local) return 0;
  const existing = await db
    .from("seo_keywords")
    .select("id,keyword")
    .eq("project_id", projectId)
    .eq("status", "active");
  if (existing.error) throw existing.error;
  const excludedIds = (existing.data ?? [])
    .filter((row) => !assessKeywordServiceArea(row.keyword, policy).allowed)
    .map((row) => row.id as string);
  if (!excludedIds.length) return 0;
  const now = new Date().toISOString();
  const keywordWrite = await db
    .from("seo_keywords")
    .update({ status: "excluded_service_area", updated_at: now })
    .in("id", excludedIds);
  if (keywordWrite.error) throw keywordWrite.error;
  const opportunityWrite = await db
    .from("seo_opportunities")
    .update({ status: "dismissed", updated_at: now })
    .eq("project_id", projectId)
    .in("keyword_id", excludedIds)
    .in("status", ["open", "approved"]);
  if (opportunityWrite.error) throw opportunityWrite.error;
  return excludedIds.length;
}
