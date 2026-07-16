import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/lib/api/errors";

export function requireAdminDb() {
  const db = createSupabaseAdminClient();
  if (!db) throw new ApiError("Supabase is not configured.", 503, "NOT_CONFIGURED");
  return db;
}

export async function auditEvent(input: {
  agencyId: string; actorUserId?: string; actorType?: "user" | "system" | "github" | "vercel";
  action: string; resourceType: string; resourceId?: string; beforeState?: unknown; afterState?: unknown;
  traceId?: string; request?: Request; metadata?: Record<string, unknown>;
}) {
  const db = requireAdminDb();
  const forwarded = input.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipHash = forwarded ? createHash("sha256").update(forwarded).digest("hex") : null;
  const result = await db.from("audit_events").insert({
    agency_id: input.agencyId, actor_user_id: input.actorUserId ?? null, actor_type: input.actorType ?? "user",
    action: input.action, resource_type: input.resourceType, resource_id: input.resourceId ?? null,
    before_state: input.beforeState ?? null, after_state: input.afterState ?? null, metadata: input.metadata ?? {},
    trace_id: input.traceId ?? null, ip_hash: ipHash, user_agent: input.request?.headers.get("user-agent")?.slice(0, 500) ?? null,
  });
  if (result.error) throw new ApiError("The audit event could not be stored.", 500, "OPERATION_FAILED");
}

export async function enforceRateLimit(scopeKey: string, action: string, limit: number, windowSeconds: number) {
  const db = requireAdminDb();
  const result = await db.rpc("consume_rate_limit", { p_scope_key: scopeKey, p_action: action, p_limit: limit, p_window_seconds: windowSeconds });
  const bucket = result.data?.[0] as { allowed?: boolean; remaining?: number; reset_at?: string } | undefined;
  if (result.error || !bucket) throw new ApiError("Rate limiting is unavailable.", 503, "OPERATION_FAILED");
  if (!bucket.allowed) throw new ApiError("Too many requests. Try again after the rate limit resets.", 429, "RATE_LIMITED");
  return bucket;
}

export async function enterpriseClientId(organizationId: string, agencyId: string) {
  const db = requireAdminDb();
  const result = await db.from("clients").select("id").eq("organization_id", organizationId).eq("agency_id", agencyId).single();
  if (!result.data) throw new ApiError("Enterprise client record not found. Apply the latest database migration.", 409, "CONFLICT");
  return result.data.id as string;
}
