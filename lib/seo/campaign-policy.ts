export type AutomationMode = "MONITOR" | "RECOMMEND" | "PREPARE" | "EXECUTE_WITH_APPROVAL";
export function modeCapabilities(mode: AutomationMode) { return { collects: true, recommends: mode !== "MONITOR", preparesDrafts: mode === "PREPARE" || mode === "EXECUTE_WITH_APPROVAL", canRequestPullRequest: mode === "EXECUTE_WITH_APPROVAL", canMerge: false, canPublish: false }; }
export function evaluateBudget(input: { status: string; monthlyBudget: number; dailyLimit: number; runLimit: number; monthSpend: number; daySpend: number; estimatedCost: number; paidEnabled: boolean }) {
  if (input.status !== "active") return { allowed: false, reason: "Campaign is not active." };
  if (!input.paidEnabled) return { allowed: false, reason: "Paid collection is disabled." };
  if (input.monthSpend + input.estimatedCost > input.monthlyBudget) return { allowed: false, reason: "Monthly budget would be exceeded." };
  if (input.dailyLimit > 0 && input.daySpend + input.estimatedCost > input.dailyLimit) return { allowed: false, reason: "Daily budget would be exceeded." };
  if (input.runLimit > 0 && input.estimatedCost > input.runLimit) return { allowed: false, reason: "Per-run limit would be exceeded." };
  return { allowed: true, reason: "Budget checks passed." };
}
export function freshnessState(checkedAt: string | null, maxAgeDays: number, now = new Date()) { if (!checkedAt) return "stale" as const; const age = (now.getTime() - new Date(checkedAt).getTime()) / 86_400_000; return age <= maxAgeDays ? "fresh" as const : age <= maxAgeDays * 1.25 ? "aging" as const : "stale" as const; }
