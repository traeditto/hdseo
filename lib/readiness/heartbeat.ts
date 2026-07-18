import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type HeartbeatStatus = "healthy" | "degraded" | "failed";

/**
 * Records scheduler liveness independently from job activity. A scheduler can
 * be healthy while its queue is idle, so worker/job heartbeats must never be
 * used as a substitute for an invocation heartbeat.
 */
export async function recordSystemHeartbeat(input: {
  component: string;
  status: HeartbeatStatus;
  workerId: string;
  metadata?: Record<string, unknown>;
  db?: SupabaseClient;
}) {
  const db = input.db ?? createSupabaseAdminClient();
  if (!db) return false;
  const timestamp = new Date().toISOString();
  const result = await db.from("system_heartbeats").upsert(
    {
      component: input.component,
      status: input.status,
      worker_id: input.workerId,
      last_seen_at: timestamp,
      metadata: input.metadata ?? {},
      updated_at: timestamp,
    },
    { onConflict: "component" },
  );
  return !result.error;
}
