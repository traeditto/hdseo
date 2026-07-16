export interface SeoDeploymentSnapshot {
  title: string | null;
  description: string | null;
  canonical: string | null;
  h1Text: string | null;
  h1Count: number;
  metaRobots: string | null;
  schemaTypes: string[];
  performanceScore: number | null;
}

export interface DriftFinding {
  code: string;
  severity: "critical" | "warning" | "info";
  before: unknown;
  after: unknown;
  message: string;
}

export interface DriftResult {
  status: "passed" | "warning" | "failed" | "skipped";
  required: boolean;
  findings: DriftFinding[];
  baseline: SeoDeploymentSnapshot | null;
  current: SeoDeploymentSnapshot;
}

const normalized = (value: string | null) => value?.trim().toLowerCase() ?? "";

export function compareSeoDrift(
  baseline: SeoDeploymentSnapshot | null,
  current: SeoDeploymentSnapshot,
): DriftResult {
  if (!baseline) {
    return { status: "skipped", required: false, findings: [], baseline, current };
  }
  const findings: DriftFinding[] = [];
  const add = (
    code: string,
    severity: DriftFinding["severity"],
    before: unknown,
    after: unknown,
    message: string,
  ) => findings.push({ code, severity, before, after, message });

  if (baseline.title && !current.title) add("title_removed", "critical", baseline.title, null, "The title tag was removed.");
  else if (baseline.title && current.title && normalized(baseline.title) !== normalized(current.title)) add("title_changed", "warning", baseline.title, current.title, "The title tag changed; verify the approved keyword target and search intent.");
  if (baseline.canonical && !current.canonical) add("canonical_removed", "critical", baseline.canonical, null, "The canonical tag was removed.");
  else if (baseline.canonical && current.canonical && normalized(baseline.canonical) !== normalized(current.canonical)) add("canonical_changed", "critical", baseline.canonical, current.canonical, "The canonical URL changed.");
  if (baseline.h1Count > 0 && current.h1Count === 0) add("h1_removed", "critical", baseline.h1Text, null, "The primary H1 was removed.");
  else if (baseline.h1Text && current.h1Text && normalized(baseline.h1Text) !== normalized(current.h1Text)) add("h1_changed", "warning", baseline.h1Text, current.h1Text, "The primary H1 changed.");
  if (!normalized(baseline.metaRobots).includes("noindex") && normalized(current.metaRobots).includes("noindex")) add("noindex_added", "critical", baseline.metaRobots, current.metaRobots, "A noindex directive was introduced.");
  const removedSchema = baseline.schemaTypes.filter((type) => !current.schemaTypes.includes(type));
  if (removedSchema.length) add("schema_types_removed", baseline.schemaTypes.length > 0 && current.schemaTypes.length === 0 ? "critical" : "warning", baseline.schemaTypes, current.schemaTypes, `Structured-data types were removed: ${removedSchema.join(", ")}.`);
  if (baseline.description && !current.description) add("description_removed", "warning", baseline.description, null, "The meta description was removed.");
  if (baseline.performanceScore != null && current.performanceScore != null && baseline.performanceScore-current.performanceScore>=10) add("performance_regression", "warning", baseline.performanceScore, current.performanceScore, `Mobile performance dropped ${baseline.performanceScore-current.performanceScore} points.`);

  const critical = findings.some((finding) => finding.severity === "critical");
  const warnings = findings.some((finding) => finding.severity === "warning");
  return {
    status: critical ? "failed" : warnings ? "warning" : "passed",
    required: true,
    findings,
    baseline,
    current,
  };
}

export function deploymentSnapshotFromChecks(
  checks: Array<{ checkType?: string; check_type?: string; score?: number | null; details?: Record<string, unknown> }>,
): SeoDeploymentSnapshot {
  const byType = new Map(checks.map((check) => [check.checkType ?? check.check_type, check]));
  const seo = byType.get("seo")?.details ?? {};
  const schema = byType.get("schema")?.details ?? {};
  const lighthouse = byType.get("lighthouse");
  return {
    title: typeof seo.title === "string" ? seo.title : null,
    description: typeof seo.description === "string" ? seo.description : null,
    canonical: typeof seo.canonical === "string" ? seo.canonical : null,
    h1Text: typeof seo.h1Text === "string" ? seo.h1Text : null,
    h1Count: Number(seo.h1Count ?? 0),
    metaRobots: typeof seo.metaRobots === "string" ? seo.metaRobots : null,
    schemaTypes: Array.isArray(schema.types) ? schema.types.filter((value): value is string => typeof value === "string") : [],
    performanceScore: lighthouse?.score == null ? null : Number(lighthouse.score),
  };
}
