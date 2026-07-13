import { z } from "zod";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { jsonError, ApiError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { providerOperations } from "@/lib/providers/dataforseo/operations";

const schema = z.object({ agencyId: z.string().uuid(), clientId: z.string().uuid(), projectId: z.string().uuid(), operation: z.enum(["keyword_overview","ranked_keywords","competitor_discovery","relevant_pages"]), units: z.number().int().positive().max(1000), scope: z.record(z.string(), z.unknown()).default({}) });

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, schema);
    const context = await resolveTenantContext({ agencyId: input.agencyId, clientId: input.clientId, projectId: input.projectId, requireProject: true });
    requirePermission(context, "provider.authorize");
    const estimatedCost = Number((providerOperations[input.operation].estimateUnitCost * input.units).toFixed(4));
    const db = createSupabaseAdminClient(); if (!db || !context.client || !context.project) throw new ApiError("Supabase is not configured.", 503, "NOT_CONFIGURED");
    const confirmation = await db.from("provider_operation_confirmations").insert({ agency_id: context.agency.id, client_organization_id: context.client.id, project_id: context.project.id, provider: "dataforseo", operation_type: input.operation, requested_by: context.user.id, estimated_units: input.units, estimated_cost: estimatedCost, scope: input.scope, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }).select("id,estimated_cost,estimated_units,expires_at").single();
    if (!confirmation.data) throw new ApiError("The confirmation could not be recorded.", 500, "OPERATION_FAILED");
    return Response.json({ ok: true, confirmation: confirmation.data });
  } catch (error) { return jsonError(error); }
}
