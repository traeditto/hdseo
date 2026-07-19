import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logServerError } from "@/lib/api/errors";
import { evidenceFreshness, queueStaleEvidence } from "./freshness";

type Policy = {
  id: string;
  agency_id: string;
  client_organization_id: string;
  project_id: string;
};

/**
 * Claims due policies atomically so concurrent regions cannot schedule the same
 * tenant at once. The individual evidence jobs remain idempotent as a second
 * line of defense.
 */
export async function scheduleDueEvidence(
  db: SupabaseClient,
  workerId: string,
  batchSize = 25,
) {
  const recovered = await db.rpc("recover_stale_background_jobs", {
    p_limit: Math.max(25, batchSize * 4),
  });
  const claim = await db.rpc("claim_due_evidence_policies", {
    p_worker_id: workerId,
    p_batch_size: batchSize,
  });
  if (claim.error) throw new Error("Due evidence policies could not be claimed.");

  const results: Array<Record<string, unknown>> = [];
  for (const policy of (claim.data ?? []) as Policy[]) {
    const tenant = {
      agencyId: policy.agency_id,
      clientId: policy.client_organization_id,
      projectId: policy.project_id,
    };
    try {
      const freshness = await evidenceFreshness(db, tenant);
      const jobs = freshness.ready
        ? []
        : await queueStaleEvidence(db, tenant, freshness);
      results.push({
        projectId: tenant.projectId,
        status: freshness.ready ? "fresh" : jobs.length ? "queued" : "blocked",
        stale: freshness.stale,
        jobs,
      });
    } catch (error) {
      const referenceId = logServerError("evidence_schedule_failed", error, {
        agencyId: tenant.agencyId,
        projectId: tenant.projectId,
        operation: "schedule_due_evidence",
      });
      results.push({ projectId: tenant.projectId, status: "failed", referenceId });
    }
  }

  const recovery = Array.isArray(recovered.data) ? recovered.data[0] ?? {} : {};
  return {
    claimed: (claim.data ?? []).length,
    recovery,
    results,
  };
}
