export const PREVIEW_JOB_STALE_AFTER_MS = 10 * 60 * 1000;

export type PreviewContinuationJobState = {
  status: string;
  lock_expires_at: string | null;
  available_at: string | null;
  attempt_count: number;
  max_attempts: number;
  updated_at: string | null;
};

function timestamp(value: string | null) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/**
 * A preview job is active only while a worker can still make progress on it.
 * Exhausted jobs are not claimable by Postgres, and old due jobs indicate a
 * lost scheduler/claim. Treating either as active would strand the customer
 * receipt at "Preview" forever.
 */
export function previewContinuationJobIsActive(
  job: PreviewContinuationJobState | null | undefined,
  now = Date.now(),
) {
  if (!job || job.attempt_count >= job.max_attempts) return false;

  if (job.status === "running") {
    const lockExpiresAt = timestamp(job.lock_expires_at);
    return Number.isFinite(lockExpiresAt) && lockExpiresAt > now;
  }

  if (!["queued", "retry_scheduled"].includes(job.status)) return false;

  const availableAt = timestamp(job.available_at);
  if (Number.isFinite(availableAt) && availableAt > now) return true;

  const updatedAt = timestamp(job.updated_at);
  return Number.isFinite(updatedAt) && now - updatedAt < PREVIEW_JOB_STALE_AFTER_MS;
}
