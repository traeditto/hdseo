import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError, logEvent } from "@/lib/api/errors";

export type ManagedAgentWakeReason =
  | "evidence_ready"
  | "opportunity_ready"
  | "discovery_completed"
  | "specialist_completed"
  | "approval_decided"
  | "workflow_recovered";

/**
 * Moves an active Autopilot enrollment onto the next scheduler tick.
 *
 * This is deliberately a wake-up signal, not an inline execution path. The
 * normal scheduler still owns leasing, idempotency, capacity reservation,
 * approval policy, and billing. Evidence workers therefore cannot bypass any
 * of the managed-service safeguards when they discover something useful.
 */
export async function wakeManagedAgentService(
  db: SupabaseClient,
  input: {
    agencyId: string;
    clientId: string;
    projectId: string;
    reason: ManagedAgentWakeReason;
  },
) {
  const timestamp = new Date().toISOString();
  const result = await db
    .from("agent_service_enrollments")
    .update({ next_cycle_at: timestamp, updated_at: timestamp })
    .eq("agency_id", input.agencyId)
    .eq("client_organization_id", input.clientId)
    .eq("project_id", input.projectId)
    .eq("service_mode", "managed_agent")
    .in("status", ["trialing", "active"])
    .select("id");

  if (result.error) {
    throw new ApiError(
      "Autopilot could not be notified that fresh evidence is ready.",
      503,
      "DATABASE_BINDING_FAILED",
    );
  }

  const enrollmentIds = (result.data ?? []).map((row) => String(row.id));
  logEvent("managed_agent_wake_requested", {
    agencyId: input.agencyId,
    projectId: input.projectId,
    stage: input.reason,
    status: enrollmentIds.length ? "scheduled" : "not_enrolled",
    enrollmentCount: enrollmentIds.length,
  });
  return { scheduled: enrollmentIds.length, enrollmentIds };
}
