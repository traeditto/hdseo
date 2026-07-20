import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ChatGPTUser } from "@/app/chatgpt-auth";

export type LiveScope = "agency" | "client" | "admin";

export type LiveIdentity = {
  userId: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
};

export class LiveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveConfigError";
  }
}

/**
 * Transitional privileged client for worker/callback compatibility only.
 * Canonical Vercel portal requests authenticate with Supabase sessions; new
 * user-facing operations must use RLS or a narrowly scoped audited RPC.
 */
export function getLiveAdminClient(): SupabaseClient {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new LiveConfigError(
      "Supabase service-role configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return client;
}

/**
 * Resolves an already-provisioned account. Authentication requests must never
 * create auth users, attach tenant memberships, or promote administrators.
 * Those are separate, explicit and audited provisioning operations.
 */
export async function resolveLiveIdentity(
  admin: SupabaseClient,
  chatUser: ChatGPTUser,
): Promise<LiveIdentity> {
  const email = chatUser.email.trim().toLowerCase();
  const displayName = chatUser.displayName?.trim() || email;

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (error || !profile?.id) {
    throw new LiveConfigError("The authenticated account has not been provisioned in HD SEO.");
  }

  const userId = profile.id as string;
  const { data: administrator } = await admin
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const isPlatformAdmin = Boolean(administrator?.id);

  return { userId, email, displayName, isPlatformAdmin };
}
