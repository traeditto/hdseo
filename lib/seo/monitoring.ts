export type MonitoringDecision = "CONTINUE_MONITORING" | "MILESTONE_REACHED" | "DEFEND" | "REVIEW_REQUIRED" | "TECHNICAL_CHECK" | "DECLINED" | "INCONCLUSIVE";
const milestone = (value?: string | null) => ({ "Top 20":20,"Top 10":10,"Top 5":5,"Top 3":3,"Position 1":1 } as Record<string,number>)[value ?? ""];
export function decideCheckpoint(input: { checkpointDay: number; baseline: number | null; position: number | null; rankingUrl: string | null; targetUrl: string; targetMilestone?: string | null; fresh: boolean }): MonitoringDecision {
  if (!input.fresh || input.position == null) return "INCONCLUSIVE";
  if (!input.rankingUrl) return "TECHNICAL_CHECK";
  const path = (value: string) => { try { return new URL(value, "https://placeholder.invalid").pathname.replace(/\/$/, "") || "/"; } catch { return value; } };
  if (path(input.rankingUrl) !== path(input.targetUrl)) return "TECHNICAL_CHECK";
  const target = milestone(input.targetMilestone); if (target && input.position <= target) return "MILESTONE_REACHED";
  if (input.baseline != null && input.position >= input.baseline + 5) return "DECLINED";
  if (input.baseline != null && input.position < input.baseline) return input.checkpointDay >= 30 ? "DEFEND" : "CONTINUE_MONITORING";
  return input.checkpointDay >= 60 ? "REVIEW_REQUIRED" : "CONTINUE_MONITORING";
}
export function cooldownDays(actionType: string) { return actionType === "BUILD" ? 60 : actionType === "IMPROVE" || actionType === "CONTENT" ? 30 : 14; }
