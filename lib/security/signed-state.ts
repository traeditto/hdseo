import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/api/errors";

export interface IntegrationState {
  purpose: "github_oauth" | "github_install" | "github_bind" | "vercel_connect" | "google_search_console" | "google_analytics" | "google_business_profile";
  agencyId: string;
  clientId?: string;
  projectId?: string;
  returnUrl?: string;
  userId: string;
  oauthStateId?: string;
  installationId?: number;
  setupAction?: string;
  nonce: string;
  expiresAt: number;
}

function key() {
  if (!env.APP_ENCRYPTION_KEY) throw new ApiError("Signed integration state is not configured.", 503, "NOT_CONFIGURED");
  return env.APP_ENCRYPTION_KEY;
}

export function createIntegrationState(input: Omit<IntegrationState, "nonce" | "expiresAt">, ttlSeconds = 600) {
  const payload: IntegrationState = { ...input, nonce: crypto.randomUUID(), expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyIntegrationState(value: string, purpose: IntegrationState["purpose"]) {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) throw new ApiError("Integration state is invalid.", 400, "INVALID_STATE");
  const expected = createHmac("sha256", key()).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError("Integration state signature is invalid.", 400, "INVALID_STATE");
  let state: IntegrationState;
  try { state = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as IntegrationState; }
  catch { throw new ApiError("Integration state is invalid.", 400, "INVALID_STATE"); }
  if (state.purpose !== purpose || state.expiresAt < Math.floor(Date.now() / 1000)) throw new ApiError("Integration state has expired.", 400, "INVALID_STATE");
  return state;
}

export function integrationStatePurpose(value:string):IntegrationState["purpose"]|null{
  try{const [encoded]=value.split("."),payload=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as Partial<IntegrationState>;return ["github_oauth","github_install","github_bind","vercel_connect","google_search_console","google_analytics","google_business_profile"].includes(String(payload.purpose))?payload.purpose??null:null;}catch{return null;}
}
