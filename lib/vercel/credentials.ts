import "server-only";
import { decryptSecret } from "@/lib/security/encryption";
import { requireAdminDb } from "@/lib/automation/control-plane";
import { ApiError } from "@/lib/api/errors";
import type { VercelCredentials } from "./client";

export async function loadVercelCredentials(connectionId: string, agencyId?: string): Promise<VercelCredentials> {
  const db = requireAdminDb();
  let query = db.from("vercel_connections").select("encrypted_access_token,team_id,team_slug,status").eq("id", connectionId);
  if (agencyId) query = query.eq("agency_id", agencyId);
  const result = await query.single();
  if (!result.data || result.data.status !== "active") throw new ApiError("Active Vercel connection not found.", 404, "NOT_FOUND");
  return { token:decryptSecret(result.data.encrypted_access_token), teamId:result.data.team_id, teamSlug:result.data.team_slug };
}
