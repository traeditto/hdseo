export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "TENANT_DENIED"
  | "ROLE_FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "INVALID_STATE"
  | "APPROVAL_REQUIRED"
  | "MISSING_INSTALLATION_ID"
  | "GITHUB_OAUTH_FAILED"
  | "GITHUB_JWT_FAILED"
  | "INSTALLATION_LOOKUP_FAILED"
  | "INSTALLATION_TOKEN_FAILED"
  | "REPOSITORY_LOOKUP_FAILED"
  | "REPOSITORY_NOT_AUTHORIZED"
  | "DATABASE_BINDING_FAILED"
  | "WEBSITE_CONNECTION_FAILED"
  | "WEBSITE_VERIFICATION_FAILED"
  | "GOOGLE_OAUTH_FAILED"
  | "GOOGLE_API_FAILED"
  | "SEARCH_CONSOLE_NOT_CONNECTED"
  | "PROPERTY_NOT_AUTHORIZED"
  | "LOCATION_EXCLUDED"
  | "EVIDENCE_REFRESH_REQUIRED"
  | "CRAWL_FAILED"
  | "CREATIVE_EVIDENCE_REQUIRED"
  | "CREATIVE_GENERATION_FAILED"
  | "CREATIVE_QA_FAILED"
  | "SERVICE_AREA_REQUIRED"
  | "SERVICE_REQUIRED"
  | "UNSAFE_AUTHORITY_TACTIC"
  | "ONBOARDING_INCOMPLETE"
  | "BILLING_ACCOUNT_REQUIRED"
  | "SUBSCRIPTION_REQUIRED"
  | "TRIAL_EXPIRED"
  | "TRIAL_LIMIT_REACHED"
  | "AGENCY_SUBSCRIPTION_REQUIRED"
  | "BILLING_PORTAL_REQUIRED"
  | "PLAN_MISMATCH"
  | "PLAN_CAPACITY_CONFLICT"
  | "AGENCY_CLIENT_LIMIT_REACHED"
  | "AGENCY_SCALE_LIMIT_REACHED"
  | "BILLING_PROVIDER_FAILED"
  | "PAYMENT_VERIFICATION_FAILED"
  | "MODEL_REQUEST_COST_LIMIT"
  | "PROJECT_DAILY_MODEL_BUDGET_EXCEEDED"
  | "PLATFORM_DAILY_MODEL_BUDGET_EXCEEDED"
  | "PROVIDER_BUDGET_EXCEEDED"
  | "INVALID_WEBHOOK_SIGNATURE"
  | "WEBHOOK_REPLAY_REJECTED"
  | "AUDIT_FAILED"
  | "OPERATION_FAILED";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: ApiErrorCode, public referenceId = crypto.randomUUID()) { super(message); this.name = "ApiError"; }
}

export function safeError(error: unknown) {
  if (error instanceof ApiError) return { status: error.status, body: { ok: false, error: { code: error.code, message: error.message, referenceId: error.referenceId } } };
  const referenceId = crypto.randomUUID();
  logEvent("unhandled_error", { referenceId });
  return { status: 500, body: { ok: false, error: { code: "OPERATION_FAILED", message: "The operation could not be completed.", referenceId } } };
}

export function jsonError(error: unknown) { const safe = safeError(error); return Response.json(safe.body, { status: safe.status }); }

function redactErrorMessage(value: string) {
  return value
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[REDACTED_PEM]")
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/(authorization|token|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

export function logServerError(event: string, error: unknown, context: Record<string, LogValue> = {}) {
  const referenceId=context.referenceId??(error instanceof ApiError?error.referenceId:crypto.randomUUID());
  const errorName=error instanceof Error?error.name:"UnknownError";
  const errorMessage=redactErrorMessage(error instanceof Error?error.message:String(error));
  const safe=Object.fromEntries(Object.entries(context).filter(([key,value])=>allowed.has(key)&&value!==undefined));
  console.error(JSON.stringify({system:"hd_seo",event,...safe,referenceId,errorName,errorMessage,timestamp:new Date().toISOString()}));
  return String(referenceId);
}

type LogValue = string | number | boolean | null | undefined;
const allowed = new Set(["referenceId", "agencyId", "clientId", "projectId", "jobId", "executionId", "stage", "status", "durationMs", "errorCode", "provider", "operation"]);
export function logEvent(event: string, context: Record<string, LogValue> = {}) {
  const safe = Object.fromEntries(Object.entries(context).filter(([key, value]) => allowed.has(key) && value !== undefined));
  console.info(JSON.stringify({ system: "hd_seo", event, ...safe, timestamp: new Date().toISOString() }));
}
