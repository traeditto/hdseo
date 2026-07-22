import "server-only";

import { redirect } from "next/navigation";

import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { resolvePortalAccess } from "@/lib/auth/portal-access";
import type { PortalRole } from "@/lib/auth/portal-types";

/**
 * Resolves identity only on the canonical Vercel application. Sites and other
 * preview surfaces never receive privileged portal access or backend secrets.
 */
export async function requirePortalUser(
  portal: PortalRole,
  _returnTo = `/portal/${portal}`,
): Promise<ChatGPTUser> {
  void _returnTo;
  if (process.env.VERCEL) {
    const access = await resolvePortalAccess(portal);
    if (!access) redirect(`/login/${portal}`);
    return {
      displayName: access.displayName,
      email: access.email,
      fullName: access.displayName,
    };
  }

  redirect(`https://hdseo.vercel.app/login/${portal}`);
}
