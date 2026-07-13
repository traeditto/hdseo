export type ApiErrorCode = "AUTH_REQUIRED" | "TENANT_DENIED" | "ROLE_FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "NOT_CONFIGURED" | "RATE_LIMITED" | "OPERATION_FAILED";

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

type LogValue = string | number | boolean | null | undefined;
const allowed = new Set(["referenceId", "agencyId", "clientId", "projectId", "jobId", "executionId", "stage", "status", "durationMs", "errorCode", "provider", "operation"]);
export function logEvent(event: string, context: Record<string, LogValue> = {}) {
  const safe = Object.fromEntries(Object.entries(context).filter(([key, value]) => allowed.has(key) && value !== undefined));
  console.info(JSON.stringify({ system: "hd_seo", event, ...safe, timestamp: new Date().toISOString() }));
}
