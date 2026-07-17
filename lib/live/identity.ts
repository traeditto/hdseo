import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { platformAdminEmails } from "@/lib/config/env";
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
 * Returns the shared service-role client used by the portal.
 *
 * The portal authenticates through ChatGPT headers rather than a Supabase
 * session, so it cannot rely on `auth.uid()` RLS. Tenant scoping is instead
 * enforced explicitly in the store/route code via the resolved identity.
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
 * Finds (or creates) the auth.users row that backs a ChatGPT identity, keeps
 * the profile row in sync, links the user to any client org that lists them as
 * the primary contact, and bootstraps platform-admin access from the allowlist.
 */
export async function resolveLiveIdentity(
  admin: SupabaseClient,
  chatUser: ChatGPTUser,
): Promise<LiveIdentity> {
  const email = chatUser.email.trim().toLowerCase();
  const displayName = chatUser.displayName?.trim() || email;

  const userId = await findOrCreateAuthUser(admin, email, displayName);

  await admin.from("profiles").upsert(
    {
      id: userId,
      email,
      display_name: displayName,
    },
    { onConflict: "id" },
  );

  const isPlatformAdmin = await ensurePlatformAdmin(admin, userId, email);
  await autoLinkClientContact(admin, userId, email);

  return { userId, email, displayName, isPlatformAdmin };
}

async function findOrCreateAuthUser(
  admin: SupabaseClient,
  email: string,
  displayName: string,
): Promise<string> {
  // Fast path: the profile row already carries the email → auth user id.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existingProfile?.id) return existingProfile.id as string;

  // Otherwise create the auth user. If it already exists (race or profile
  // backfill gap), fall back to looking it up in the auth admin API.
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName, source: "chatgpt-portal" },
  });

  if (created.data?.user?.id) return created.data.user.id;

  const alreadyExists =
    created.error &&
    /already been registered|already exists|duplicate/i.test(
      created.error.message,
    );
  if (alreadyExists) {
    const found = await findAuthUserByEmail(admin, email);
    if (found) return found;
  }

  throw new LiveConfigError(
    `Unable to resolve a Supabase user for ${email}: ${created.error?.message ?? "unknown error"}`,
  );
}

async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  // listUsers is paginated; scan a bounded number of pages defensively.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) return null;
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensurePlatformAdmin(
  admin: SupabaseClient,
  userId: string,
  email: string,
): Promise<boolean> {
  const { data: existing } = await admin
    .from("platform_admins")
    .select("id,status")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.id) {
    return existing.status === "active";
  }

  // Platform administration is explicit. Never promote the first person who
  // happens to sign in to a new environment.
  if (!platformAdminEmails.has(email)) return false;

  await admin
    .from("platform_admins")
    .upsert(
      { user_id: userId, status: "active", role: "platform_admin" },
      { onConflict: "user_id" },
    );
  return true;
}

async function autoLinkClientContact(
  admin: SupabaseClient,
  userId: string,
  email: string,
): Promise<void> {
  const { data: orgs } = await admin
    .from("client_organizations")
    .select("id,agency_id")
    .ilike("primary_contact_email", email);

  if (!orgs?.length) return;

  for (const org of orgs) {
    const { data: member } = await admin
      .from("client_members")
      .select("id")
      .eq("client_organization_id", org.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (member?.id) continue;

    await admin.from("client_members").insert({
      agency_id: org.agency_id,
      client_organization_id: org.id,
      user_id: userId,
      role: "client_admin",
      status: "active",
    });
  }
}
