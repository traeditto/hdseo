import "server-only";

import { redirect } from "next/navigation";

import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { appBaseUrl } from "@/lib/config/env";
import { resolvePortalAccess } from "@/lib/auth/portal-access";
import type { PortalRole } from "@/lib/auth/portal-types";

/**
 * Privileged portals exist only on the canonical Vercel application. Sites is
 * deliberately limited to marketing and private previews.
 */
export async function requirePortalUser(
  portal: PortalRole,
  returnTo = `/portal/${portal}`,
): Promise<ChatGPTUser> {
  if (!process.env.VERCEL) {
    redirect(new URL(`/login/${portal}`, `${appBaseUrl()}/`).toString());
  }
  const access = await resolvePortalAccess(portal);
  if (!access) redirect(`/login/${portal}?returnTo=${encodeURIComponent(returnTo)}`);
  return {displayName:access.displayName,email:access.email,fullName:access.displayName};
}
