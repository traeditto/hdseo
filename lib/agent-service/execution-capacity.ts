export type ExecutionCapacityInput = {
  actionType?: string | null;
  evidence?: unknown;
  recommendedActions?: unknown;
  monthlyCapacity: number;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const baseCapacityByAction: Record<string, number> = {
  CTR_WIN: 1,
  DEFEND: 1,
  LINK: 1,
  CONVERSION: 2,
  IMPROVE: 2,
  MAPS: 2,
  TECHNICAL: 2,
  LOCALIZE: 3,
  BUILD: 4,
  CONTENT: 4,
};

/**
 * Capacity is an internal planning weight, not a count of agent handoffs.
 * A focused campaign may use the full monthly allocation when the evidence
 * explicitly identifies it as the best portfolio-level investment.
 */
export function executionCapacityForOpportunity(
  input: ExecutionCapacityInput,
) {
  const monthlyCapacity = Math.max(1, Math.floor(input.monthlyCapacity));
  const evidence = record(input.evidence);
  const focusCampaign = record(evidence.focusCampaign);
  const portfolioCapacity = Number(
    record(evidence.portfolioCampaign).capacityUnits,
  );
  const actionType = String(input.actionType ?? "").toUpperCase();

  if (Number.isFinite(portfolioCapacity) && portfolioCapacity > 0) {
    return Math.min(monthlyCapacity, Math.max(1, Math.floor(portfolioCapacity)));
  }
  if (focusCampaign.active === true) return monthlyCapacity;

  let units = baseCapacityByAction[actionType] ?? 2;
  const recommendations = Array.isArray(input.recommendedActions)
    ? input.recommendedActions
    : [];
  if (recommendations.length >= 4) units += 1;

  return Math.max(1, Math.min(monthlyCapacity, units));
}

export function availableExecutionCapacity(input: {
  monthlyCapacity: number;
  usedCapacity: number;
  prepaidCapacity?: number | null;
}) {
  return (
    Math.max(0, input.monthlyCapacity - input.usedCapacity) +
    Math.max(0, Number(input.prepaidCapacity ?? 0))
  );
}
