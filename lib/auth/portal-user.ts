import "server-only";

import { redirect } from "next/navigation";

import { requireChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";
import { hasSupabaseAdminConfig } from "@/lib/config/env";
import { resolvePortalAccess } from "@/lib/auth/portal-access";
import type { PortalRole } from "@/lib/auth/portal-types";

/**
 * Resolves the identity used by the live portals on both production surfaces.
 * Vercel uses the application's Supabase session; Sites supplies a verified
 * ChatGPT identity header. Both are normalized to the same portal user shape.
 */
export async function requirePortalUser(
  portal: PortalRole,
  returnTo = `/portal/${portal}`,
): Promise<ChatGPTUser> {
  if (process.env.VERCEL) {
    const access = await resolvePortalAccess(portal);
    if (!access) redirect(`/login/${portal}`);
    return {
      displayName: access.displayName,
      email: access.email,
      fullName: access.displayName,
    };
  }

  // The Sites copy is allowed to host the portal only when it has the same
  // production data connection. Otherwise keep users on the canonical app
  // instead of letting the worker fail after authentication.
  if (!hasSupabaseAdminConfig) {
    redirect(`https://hdseo.vercel.app/login/${portal}`);
  }

  return requireChatGPTUser(returnTo);
}
