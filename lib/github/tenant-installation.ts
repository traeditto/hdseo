import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/errors";

export type AgencyInstallationRecord = {
  id: string;
  agencyId: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  status: string;
  lastSyncedAt: string | null;
};

function mapInstallation(row: {
  id: string;
  agency_id: string;
  installation_id: number | string;
  account_login: string;
  account_type: string;
  repository_selection: string;
  status: string;
  last_synced_at: string | null;
}): AgencyInstallationRecord {
  return {
    id: row.id,
    agencyId: row.agency_id,
    installationId: Number(row.installation_id),
    accountLogin: row.account_login,
    accountType: row.account_type,
    repositorySelection: row.repository_selection,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
  };
}

const installationColumns =
  "id,agency_id,installation_id,account_login,account_type,repository_selection,status,last_synced_at";

export async function findAgencyInstallationRecord(
  db: SupabaseClient,
  agencyId: string,
): Promise<AgencyInstallationRecord | null> {
  const owned = await db
    .from("github_installations")
    .select(installationColumns)
    .eq("agency_id", agencyId)
    .neq("status", "deleted")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (owned.error) {
    throw new ApiError("GitHub installation status could not be loaded.", 500, "DATABASE_BINDING_FAILED");
  }
  if (owned.data) return mapInstallation(owned.data as Parameters<typeof mapInstallation>[0]);

  const linked = await db
    .from("repository_connections")
    .select("installation_id")
    .eq("agency_id", agencyId)
    .eq("provider", "github")
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (linked.error) {
    throw new ApiError("GitHub tenant binding could not be loaded.", 500, "DATABASE_BINDING_FAILED");
  }
  if (!linked.data?.installation_id) return null;

  const installation = await db
    .from("github_installations")
    .select(installationColumns)
    .eq("installation_id", linked.data.installation_id)
    .neq("status", "deleted")
    .maybeSingle();
  if (installation.error) {
    throw new ApiError("Shared GitHub installation status could not be loaded.", 500, "DATABASE_BINDING_FAILED");
  }
  return installation.data
    ? mapInstallation(installation.data as Parameters<typeof mapInstallation>[0])
    : null;
}
