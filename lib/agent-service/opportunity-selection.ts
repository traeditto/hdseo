export type ManagedOpportunityCandidate = {
  id: string;
  opportunity_score: number | null;
  confidence_score: number | null;
  action_type: string | null;
  target_url: string | null;
  reason_codes: string[] | null;
  evidence: unknown;
  status: string;
  cooldown_until?: string | null;
};

const blockingReasonCodes = new Set([
  "ACTIVE_DUPLICATE",
  "CONFIDENCE_BELOW_THRESHOLD",
  "COOLDOWN_ACTIVE",
  "LOCATION_EXCLUDED",
  "MARKET_SCOPE_MISMATCH",
  "NO_EXPECTED_BUSINESS_VALUE",
  "PAGE_OWNERSHIP_CONFLICT",
  "PAYBACK_EXCEEDS_AUTOPILOT_LIMIT",
  "QUERY_TOO_BROAD",
  "QUERY_TOO_LONG",
  "REDUNDANT_QUERY",
  "REQUIRED_EVIDENCE_MISSING",
  "SERVICE_CAPACITY_UNAVAILABLE",
  "SERVICE_NOT_VERIFIED",
]);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function hasUsableTarget(value: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Selects only opportunities that the implementation and monitoring pipeline
 * can finish without guessing a page, geography, or business value.
 */
export function selectManagedOpportunity(
  candidates: ManagedOpportunityCandidate[],
  marketScope: "service_area" | "nationwide",
  now = new Date(),
) {
  return (
    candidates
      .filter((candidate) => {
        if (!["open", "selected", "approved"].includes(candidate.status))
          return false;
        if (!hasUsableTarget(candidate.target_url)) return false;
        if (Number(candidate.opportunity_score ?? 0) < 55) return false;
        if (Number(candidate.confidence_score ?? 0) < 55) return false;
        if (
          candidate.cooldown_until &&
          new Date(candidate.cooldown_until).getTime() > now.getTime()
        )
          return false;

        const reasons = new Set(candidate.reason_codes ?? []);
        if ([...reasons].some((reason) => blockingReasonCodes.has(reason)))
          return false;
        if (
          marketScope === "service_area" &&
          !reasons.has("LOCAL_RELEVANCE") &&
          !reasons.has("TARGET_MARKET_SCOPED")
        )
          return false;

        const evidence = record(candidate.evidence);
        const businessValue = record(evidence.businessValue);
        const expectedProfit = Number(businessValue.expectedMonthlyProfit);
        const paybackMonths = Number(businessValue.paybackMonths);
        if (!Number.isFinite(expectedProfit) || expectedProfit <= 0) return false;
        if (Number.isFinite(paybackMonths) && paybackMonths > 60) return false;
        if (
          Array.isArray(evidence.missingEvidence) &&
          evidence.missingEvidence.length > 3
        )
          return false;
        return true;
      })
      .sort(
        (a, b) =>
          Number(b.opportunity_score ?? 0) *
            Number(b.confidence_score ?? 0) -
          Number(a.opportunity_score ?? 0) *
            Number(a.confidence_score ?? 0),
      )[0] ?? null
  );
}
