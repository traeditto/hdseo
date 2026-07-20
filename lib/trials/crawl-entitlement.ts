import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/errors";

export type WebsiteCrawlAccess = {
  mode: "trial" | "paid" | "managed";
  usageId: string | null;
  remaining: number | null;
  idempotencyKey: string;
};

type ClaimRow = {
  decision?: unknown;
  usage_id?: unknown;
  remaining?: unknown;
};

function firstRow(value: unknown): ClaimRow | null {
  if (Array.isArray(value)) return (value[0] as ClaimRow | undefined) ?? null;
  return value && typeof value === "object" ? (value as ClaimRow) : null;
}

export async function claimWebsiteCrawlAccess(
  db: SupabaseClient,
  input: { projectId: string; idempotencyKey: string },
): Promise<WebsiteCrawlAccess> {
  const result = await db.rpc("claim_client_website_crawl", {
    p_project_id: input.projectId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (result.error) {
    throw new ApiError(
      "Free-trial crawl controls are not ready. Apply migration 0031 and retry.",
      503,
      "DATABASE_BINDING_FAILED",
    );
  }
  const row = firstRow(result.data);
  const decision = typeof row?.decision === "string" ? row.decision : "";
  if (decision === "expired") {
    throw new ApiError(
      "Your free crawl trial has expired. Choose a plan to continue crawling this website.",
      402,
      "TRIAL_EXPIRED",
    );
  }
  if (decision === "exhausted") {
    throw new ApiError(
      "Your included free website crawl has already been used. Choose a plan for ongoing crawls and monitoring.",
      402,
      "TRIAL_LIMIT_REACHED",
    );
  }
  if (decision === "not_eligible") {
    throw new ApiError(
      "An active subscription is required before another website crawl can run.",
      402,
      "SUBSCRIPTION_REQUIRED",
    );
  }
  if (!["granted", "already_claimed", "paid", "managed"].includes(decision)) {
    throw new ApiError(
      "HD SEO could not verify crawl access for this project.",
      503,
      "DATABASE_BINDING_FAILED",
    );
  }
  return {
    mode:
      decision === "paid"
        ? "paid"
        : decision === "managed"
          ? "managed"
          : "trial",
    usageId: typeof row?.usage_id === "string" ? row.usage_id : null,
    remaining:
      row?.remaining == null || !Number.isFinite(Number(row.remaining))
        ? null
        : Math.max(0, Number(row.remaining)),
    idempotencyKey: input.idempotencyKey,
  };
}

export async function markTrialCrawlQueued(
  db: SupabaseClient,
  access: WebsiteCrawlAccess,
  jobId: string,
) {
  if (access.mode !== "trial" || !access.usageId) return;
  const result = await db.rpc("mark_client_trial_crawl_queued", {
    p_usage_id: access.usageId,
    p_background_job_id: jobId,
  });
  if (result.error || result.data !== true) {
    throw new ApiError(
      "The free crawl was queued, but its trial usage record needs reconciliation before retrying.",
      503,
      "DATABASE_BINDING_FAILED",
    );
  }
}

export async function releaseTrialCrawlClaim(
  db: SupabaseClient,
  access: WebsiteCrawlAccess,
  errorCode = "QUEUE_FAILED",
) {
  if (access.mode !== "trial" || !access.usageId) return;
  await db.rpc("release_client_trial_crawl_claim", {
    p_usage_id: access.usageId,
    p_failure_code: errorCode,
  });
}

export async function settleTrialCrawl(
  db: SupabaseClient,
  input: { jobId: string; status: "succeeded" | "failed"; errorCode?: string },
) {
  const result = await db.rpc("settle_client_trial_crawl", {
    p_background_job_id: input.jobId,
    p_status: input.status,
    p_failure_code: input.errorCode ?? null,
  });
  // The worker may process pre-migration or agency-managed jobs. A missing
  // trial usage row returns false and is intentionally not an execution error.
  return !result.error;
}
