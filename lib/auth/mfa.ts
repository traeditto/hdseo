import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function currentAal(db?: SupabaseClient) {
  const client = db ?? await createSupabaseServerClient();
  if (!client) throw new ApiError("Authentication is not configured.", 503, "NOT_CONFIGURED");
  const result = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (result.error) throw new ApiError("The session assurance level could not be verified.", 401, "MFA_REQUIRED");
  return result.data;
}

export async function requireAal2(db?: SupabaseClient) {
  const assurance = await currentAal(db);
  if (assurance.currentLevel !== "aal2") {
    throw new ApiError("Multi-factor authentication is required for this action.", 403, "MFA_REQUIRED");
  }
  return assurance;
}

export async function requirePortalAal2(returnTo: string) {
  const assurance = await currentAal();
  if (assurance.currentLevel !== "aal2") {
    redirect(`/security/mfa?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`);
  }
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://hdseo.local");
    return parsed.origin === "https://hdseo.local" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch { return "/"; }
}
