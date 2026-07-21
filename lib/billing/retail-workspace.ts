import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/errors";

type BillingStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";

function agencyStatus(status: BillingStatus) {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  return "suspended";
}

export async function applyRetailWorkspaceBillingState(
  db: SupabaseClient,
  input: { agencyId: string; projectId: string; status: BillingStatus },
) {
  const agency = await db
    .from("agencies")
    .select("id,plan,status")
    .eq("id", input.agencyId)
    .maybeSingle();
  if (agency.error || !agency.data) {
    throw new ApiError("The paid business workspace could not be resolved.", 503, "DATABASE_BINDING_FAILED");
  }
  if (agency.data.plan !== "retail") return agency.data.status as string;

  const nextAgencyStatus = agencyStatus(input.status);
  const updated = await db
    .from("agencies")
    .update({ status: nextAgencyStatus, updated_at: new Date().toISOString() })
    .eq("id", input.agencyId)
    .eq("plan", "retail");
  if (updated.error) {
    throw new ApiError("The paid business workspace status could not be updated.", 503, "DATABASE_BINDING_FAILED");
  }

  if (nextAgencyStatus === "active") {
    const project = await db
      .from("seo_projects")
      .select("client_organization_id")
      .eq("id", input.projectId)
      .eq("agency_id", input.agencyId)
      .maybeSingle();
    if (project.error || !project.data) {
      throw new ApiError("The paid business project could not be activated.", 503, "DATABASE_BINDING_FAILED");
    }
    const [organization, client] = await Promise.all([
      db
        .from("client_organizations")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", project.data.client_organization_id)
        .eq("agency_id", input.agencyId),
      db
        .from("clients")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("organization_id", project.data.client_organization_id)
        .eq("agency_id", input.agencyId),
    ]);
    if (organization.error || client.error) {
      throw new ApiError("The paid business records could not be activated.", 503, "DATABASE_BINDING_FAILED");
    }
  }
  return nextAgencyStatus;
}

export async function reconcilePaidRetailWorkspace(
  db: SupabaseClient,
  input: { agencyId: string; projectId: string },
) {
  const subscription = await db
    .from("client_subscriptions")
    .select("status,stripe_subscription_id")
    .eq("agency_id", input.agencyId)
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (
    subscription.error ||
    !subscription.data?.stripe_subscription_id ||
    !["active", "trialing"].includes(subscription.data.status)
  ) {
    return null;
  }
  return applyRetailWorkspaceBillingState(db, {
    ...input,
    status: subscription.data.status as "active" | "trialing",
  });
}
