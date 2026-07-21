import type { OpportunityResult } from "./opportunity-engine";

export interface EligibilityInput {
  projectId: string; keyword: string; targetUrl?: string | null; result: OpportunityResult;
  pageConflict?: boolean; activeDuplicate?: boolean; cooldownUntil?: string | null; evidenceRequired?: string[];
  serviceCapacity?: boolean; locationAllowed?: boolean; minimumConfidence?: number; now?: Date;
  disqualifiers?: string[];
}

export function opportunityKey(projectId: string, keyword: string, targetUrl: string | null | undefined, actionType: string) {
  return [projectId, keyword.trim().toLowerCase().replace(/\s+/g, " "), targetUrl ?? "unowned", actionType].join("|");
}

export function evaluateEligibility(input: EligibilityInput) {
  const reasons: string[] = [], now = input.now ?? new Date();
  if (input.pageConflict) reasons.push("PAGE_OWNERSHIP_CONFLICT");
  if (input.activeDuplicate) reasons.push("ACTIVE_DUPLICATE");
  if (input.cooldownUntil && new Date(input.cooldownUntil) > now) reasons.push("COOLDOWN_ACTIVE");
  if ((input.evidenceRequired ?? []).length) reasons.push("REQUIRED_EVIDENCE_MISSING");
  if (input.serviceCapacity === false) reasons.push("SERVICE_CAPACITY_UNAVAILABLE");
  if (input.locationAllowed === false) reasons.push("LOCATION_EXCLUDED");
  reasons.push(...(input.disqualifiers??[]));
  if (input.result.confidenceScore < (input.minimumConfidence ?? 55)) reasons.push("CONFIDENCE_BELOW_THRESHOLD");
  return { eligible: reasons.length === 0, reasons, key: opportunityKey(input.projectId, input.keyword, input.targetUrl, input.result.actionType) };
}

export function selectNextBestAction<T extends { score: number; confidence: number; eligible: boolean; targetUrl?: string | null; opportunityId: string }>(candidates: T[]) {
  const targets = new Set<string>();
  return candidates.filter((candidate) => candidate.eligible).sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence)).find((candidate) => {
    const key = candidate.targetUrl ?? candidate.opportunityId;
    if (targets.has(key)) return false;
    targets.add(key); return true;
  }) ?? null;
}
