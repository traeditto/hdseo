import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { resolveClientContext } from "@/lib/auth/context";
import { appBaseUrl, env } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, z.object({ projectId: z.string().uuid() }));
    const context = await resolveClientContext({ projectId: input.projectId, requireProject: true });
    if (context.role !== "client_admin") throw new ApiError("Only the business owner can manage billing.", 403, "ROLE_FORBIDDEN");
    if (!env.STRIPE_SECRET_KEY) throw new ApiError("Stripe billing is not configured yet.", 503, "NOT_CONFIGURED");
    const db = getLiveAdminClient();
    const row = await db.from("client_subscriptions").select("stripe_customer_id").eq("project_id", input.projectId).eq("client_organization_id", context.client.id).maybeSingle();
    if (!row.data?.stripe_customer_id) throw new ApiError("Choose a paid plan before opening billing management.", 409, "BILLING_ACCOUNT_REQUIRED");
    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ customer: row.data.stripe_customer_id, return_url: `${appBaseUrl()}/portal/client` }) });
    const payload = await response.json() as { url?: string; error?: { message?: string } };
    if (!response.ok || !payload.url) throw new ApiError(payload.error?.message ?? "Stripe could not open billing management.", 502, "BILLING_PROVIDER_FAILED");
    return Response.json({ ok: true, url: payload.url });
  } catch (error) { return jsonError(error); }
}
