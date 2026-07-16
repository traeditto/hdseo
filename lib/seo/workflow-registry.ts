import type { SiteClassification, SiteType } from "./site-classifier";

export type SeoWorkflowId =
  | "technical"
  | "content"
  | "schema"
  | "sitemap"
  | "performance"
  | "images"
  | "geo"
  | "search_console"
  | "local"
  | "maps"
  | "ecommerce"
  | "hreflang"
  | "cluster"
  | "drift";

export interface WorkflowDefinition {
  id: SeoWorkflowId;
  version: string;
  requiredEvidence: string[];
  optionalEvidence: string[];
  supportedSiteTypes: SiteType[] | "all";
  paidProvider: "dataforseo" | null;
  risk: "low" | "medium" | "high";
}

export interface WorkflowPlanItem extends WorkflowDefinition {
  status: "ready" | "setup_required" | "not_applicable";
  reason: string;
}

const all: WorkflowDefinition["supportedSiteTypes"] = "all";

export const workflowRegistry: Record<SeoWorkflowId, WorkflowDefinition> = {
  technical: { id: "technical", version: "1.0.0", requiredEvidence: ["site_url"], optionalEvidence: ["page_snapshots"], supportedSiteTypes: all, paidProvider: null, risk: "low" },
  content: { id: "content", version: "1.0.0", requiredEvidence: ["page_snapshots"], optionalEvidence: ["search_console"], supportedSiteTypes: all, paidProvider: null, risk: "low" },
  schema: { id: "schema", version: "1.0.0", requiredEvidence: ["page_snapshots"], optionalEvidence: ["business_evidence"], supportedSiteTypes: all, paidProvider: null, risk: "medium" },
  sitemap: { id: "sitemap", version: "1.0.0", requiredEvidence: ["site_url"], optionalEvidence: ["page_snapshots"], supportedSiteTypes: all, paidProvider: null, risk: "low" },
  performance: { id: "performance", version: "1.0.0", requiredEvidence: ["site_url"], optionalEvidence: ["pagespeed", "crux"], supportedSiteTypes: all, paidProvider: null, risk: "low" },
  images: { id: "images", version: "1.0.0", requiredEvidence: ["page_snapshots"], optionalEvidence: ["image_inventory"], supportedSiteTypes: all, paidProvider: null, risk: "low" },
  geo: { id: "geo", version: "1.0.0", requiredEvidence: ["page_snapshots"], optionalEvidence: ["entity_evidence"], supportedSiteTypes: all, paidProvider: null, risk: "low" },
  search_console: { id: "search_console", version: "1.0.0", requiredEvidence: ["search_console"], optionalEvidence: ["url_inspection"], supportedSiteTypes: all, paidProvider: null, risk: "low" },
  local: { id: "local", version: "1.0.0", requiredEvidence: ["locations"], optionalEvidence: ["business_evidence", "maps"], supportedSiteTypes: ["local_service"], paidProvider: null, risk: "medium" },
  maps: { id: "maps", version: "1.0.0", requiredEvidence: ["locations", "dataforseo"], optionalEvidence: ["gbp"], supportedSiteTypes: ["local_service"], paidProvider: "dataforseo", risk: "medium" },
  ecommerce: { id: "ecommerce", version: "1.0.0", requiredEvidence: ["page_snapshots"], optionalEvidence: ["merchant_data"], supportedSiteTypes: ["ecommerce"], paidProvider: null, risk: "medium" },
  hreflang: { id: "hreflang", version: "1.0.0", requiredEvidence: ["page_snapshots"], optionalEvidence: ["sitemap"], supportedSiteTypes: all, paidProvider: null, risk: "high" },
  cluster: { id: "cluster", version: "1.0.0", requiredEvidence: ["keywords"], optionalEvidence: ["serp_overlap"], supportedSiteTypes: all, paidProvider: "dataforseo", risk: "medium" },
  drift: { id: "drift", version: "1.0.0", requiredEvidence: ["baseline"], optionalEvidence: ["pagespeed"], supportedSiteTypes: all, paidProvider: null, risk: "high" },
};

export function buildWorkflowPlan(input: {
  classification: SiteClassification;
  pageCount: number;
  keywordCount: number;
  hasSearchConsole: boolean;
  hasDataForSeo: boolean;
  hasBaseline: boolean;
}): WorkflowPlanItem[] {
  const selected = new Set<SeoWorkflowId>([
    "technical",
    "content",
    "schema",
    "sitemap",
    "performance",
    "images",
    "geo",
  ]);
  if (input.hasSearchConsole) selected.add("search_console");
  if (input.classification.primaryType === "local_service" || input.classification.secondaryTypes.includes("local_service")) {
    selected.add("local");
    selected.add("maps");
  }
  if (input.classification.primaryType === "ecommerce" || input.classification.secondaryTypes.includes("ecommerce")) selected.add("ecommerce");
  if (input.classification.international) selected.add("hreflang");
  if (input.keywordCount >= 10 || input.pageCount >= 10) selected.add("cluster");
  if (input.hasBaseline) selected.add("drift");

  return (Object.keys(workflowRegistry) as SeoWorkflowId[]).map((id) => {
    const definition = workflowRegistry[id];
    if (!selected.has(id)) return { ...definition, status: "not_applicable", reason: "Project signals do not currently require this workflow." };
    if (definition.paidProvider === "dataforseo" && !input.hasDataForSeo) return { ...definition, status: "setup_required", reason: "DataForSEO is not connected; the rest of the plan can continue." };
    if (["content", "schema", "images", "geo", "ecommerce", "hreflang"].includes(id) && input.pageCount === 0) return { ...definition, status: "setup_required", reason: "Page evidence must be collected before this workflow can run." };
    return { ...definition, status: "ready", reason: "Selected from current project evidence and capabilities." };
  });
}
