export type ActionType = "BUILD" | "IMPROVE" | "LINK" | "LOCALIZE" | "DEFEND" | "TECHNICAL" | "CONTENT" | "MAPS";

export interface OpportunityInput {
  currentRank?: number | null;
  previousRank?: number | null;
  searchVolume?: number | null;
  cpc?: number | null;
  commercialIntentScore?: number | null;
  serviceRelevance?: number | null;
  locationRelevance?: number | null;
  competitorGap?: number | null;
  technicalReadiness?: number | null;
  hasOwnerPage?: boolean | null;
  internalLinkCount?: number | null;
  mapsAveragePosition?: number | null;
  hasCriticalTechnicalIssue?: boolean;
}

export interface ScoreFactor { label: string; points: number }

export interface OpportunityResult {
  opportunityScore: number;
  confidenceScore: number;
  actionType: ActionType;
  priority: "critical" | "high" | "medium" | "low";
  targetMilestone: "Top 20" | "Top 10" | "Top 5" | "Top 3" | "Position 1";
  reasonCodes: string[];
  evidence: ScoreFactor[];
  missingEvidence: string[];
  recommendedActions: string[];
  status: "open";
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const normalized = (value: number | null | undefined, fallback = 0) => clamp(value ?? fallback) / 100;

function rankProximity(rank: number | null | undefined) {
  if (!rank) return 6;
  if (rank === 1) return 10;
  if (rank <= 3) return 15;
  if (rank <= 6) return 25;
  if (rank <= 10) return 22;
  if (rank <= 20) return 16;
  if (rank <= 40) return 8;
  return 3;
}

function targetFor(rank: number | null | undefined): OpportunityResult["targetMilestone"] {
  if (!rank || rank > 20) return "Top 20";
  if (rank > 10) return "Top 10";
  if (rank > 5) return "Top 3";
  if (rank > 3) return "Top 3";
  return "Position 1";
}

export function scoreOpportunity(input: OpportunityInput): OpportunityResult {
  const missingEvidence: string[] = [];
  if (input.currentRank == null) missingEvidence.push("Current ranking unavailable");
  if (input.searchVolume == null) missingEvidence.push("Search demand unavailable");
  if (input.cpc == null) missingEvidence.push("CPC value unavailable");
  if (input.internalLinkCount == null) missingEvidence.push("Internal-link crawl incomplete");
  if (input.competitorGap == null) missingEvidence.push("Competitor evidence unavailable");

  const trend = input.currentRank != null && input.previousRank != null ? input.previousRank - input.currentRank : 0;
  const evidence: ScoreFactor[] = [
    { label: "Ranking proximity", points: rankProximity(input.currentRank) },
    { label: "Commercial intent", points: Math.round(normalized(input.commercialIntentScore, 45) * 20) },
    { label: "Search demand", points: Math.round(clamp(Math.log10(Math.max(input.searchVolume ?? 1, 1)) / 4 * 15, 0, 15)) },
    { label: "CPC value", points: Math.round(clamp((input.cpc ?? 0) / 50 * 12, 0, 12)) },
    { label: "Competitor gap", points: Math.round(normalized(input.competitorGap, 35) * 11) },
    { label: "Local relevance", points: Math.round(((normalized(input.serviceRelevance, 50) + normalized(input.locationRelevance, 50)) / 2) * 10) },
    { label: "Technical readiness", points: Math.round(normalized(input.technicalReadiness, 50) * 7) },
  ];

  if (trend < -2) evidence.push({ label: "Decline urgency", points: Math.min(8, Math.abs(trend)) });
  const opportunityScore = Math.round(clamp(evidence.reduce((sum, factor) => sum + factor.points, 0)));
  const confidenceScore = Math.round(clamp(94 - missingEvidence.length * 9 - (input.previousRank == null ? 5 : 0)));

  let actionType: ActionType = "IMPROVE";
  if (input.hasCriticalTechnicalIssue) actionType = "TECHNICAL";
  else if (input.hasOwnerPage === false) actionType = "BUILD";
  else if (input.mapsAveragePosition != null && input.mapsAveragePosition > 3) actionType = "MAPS";
  else if (trend < -3 && (input.currentRank ?? 100) <= 10) actionType = "DEFEND";
  else if ((input.internalLinkCount ?? 10) < 3) actionType = "LINK";
  else if ((input.locationRelevance ?? 100) < 45) actionType = "LOCALIZE";

  const reasonCodes = evidence.filter((factor) => factor.points >= 8).map((factor) => factor.label.toUpperCase().replaceAll(" ", "_"));
  const actionMap: Record<ActionType, string[]> = {
    BUILD: ["Evaluate page ownership before creating a dedicated landing page", "Prepare a verified-evidence content brief"],
    IMPROVE: ["Strengthen the existing owner page around query intent", "Review metadata, headings, proof, and schema"],
    LINK: ["Add contextual internal links from relevant service and location pages", "Verify that anchor text points to the owner page"],
    LOCALIZE: ["Add verified service-area relevance", "Resolve duplicate or conflicting local pages"],
    DEFEND: ["Compare the declining page to its last strong snapshot", "Address competitor and freshness gaps"],
    TECHNICAL: ["Resolve the blocking technical finding", "Validate canonicals, indexing, links, and schema"],
    CONTENT: ["Prepare an evidence-backed content brief", "Map supporting content to the owner page"],
    MAPS: ["Review local visibility evidence and profile completeness", "Prepare verified local authority actions"],
  };

  return {
    opportunityScore,
    confidenceScore,
    actionType,
    priority: opportunityScore >= 90 ? "critical" : opportunityScore >= 75 ? "high" : opportunityScore >= 55 ? "medium" : "low",
    targetMilestone: targetFor(input.currentRank),
    reasonCodes,
    evidence,
    missingEvidence,
    recommendedActions: actionMap[actionType],
    status: "open",
  };
}
