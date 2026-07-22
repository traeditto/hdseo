import { describe, expect, it } from "vitest";
import {
  PREVIEW_JOB_STALE_AFTER_MS,
  previewContinuationJobIsActive,
  type PreviewContinuationJobState,
} from "../lib/automation/job-state";

const now = Date.parse("2026-07-22T12:00:00.000Z");

function job(overrides: Partial<PreviewContinuationJobState> = {}): PreviewContinuationJobState {
  return {
    status: "queued",
    lock_expires_at: null,
    available_at: new Date(now - 1_000).toISOString(),
    attempt_count: 1,
    max_attempts: 8,
    updated_at: new Date(now - 1_000).toISOString(),
    ...overrides,
  };
}

describe("preview continuation job recovery", () => {
  it("does not mistake an exhausted queued job for active work", () => {
    expect(previewContinuationJobIsActive(job({ attempt_count: 8 }), now)).toBe(false);
  });

  it("does not mistake an expired worker lease for active work", () => {
    expect(
      previewContinuationJobIsActive(
        job({
          status: "running",
          lock_expires_at: new Date(now - 1).toISOString(),
        }),
        now,
      ),
    ).toBe(false);
  });

  it("preserves a live worker lease", () => {
    expect(
      previewContinuationJobIsActive(
        job({
          status: "running",
          lock_expires_at: new Date(now + 60_000).toISOString(),
        }),
        now,
      ),
    ).toBe(true);
  });

  it("preserves a retry that is intentionally delayed", () => {
    expect(
      previewContinuationJobIsActive(
        job({
          status: "retry_scheduled",
          available_at: new Date(now + 60_000).toISOString(),
          updated_at: new Date(now - PREVIEW_JOB_STALE_AFTER_MS * 2).toISOString(),
        }),
        now,
      ),
    ).toBe(true);
  });

  it("preserves a recent claimable job but recovers a stale one", () => {
    expect(previewContinuationJobIsActive(job(), now)).toBe(true);
    expect(
      previewContinuationJobIsActive(
        job({ updated_at: new Date(now - PREVIEW_JOB_STALE_AFTER_MS - 1).toISOString() }),
        now,
      ),
    ).toBe(false);
  });
});
