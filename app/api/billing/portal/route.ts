import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { resolveClientContext } from "@/lib/auth/context";
import { appBaseUrl, env } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";
import {stripeForm} from "@/lib/billing/stripe";

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, z.object({ projectId: z.string().uuid() }));
    const context = await resolveClientContext({ projectId: input.projectId, requireProject: true });
    if (context.role !== "client_admin") throw new ApiError("Only the business owner can manage billing.", 403, "ROLE_FORBIDDEN");
    if (!env.STRIPE_SECRET_KEY) throw new ApiError("Stripe billing is not configured yet.", 503, "NOT_CONFIGURED");
    const db = getLiveAdminClient();
    const row = await db.from("client_subscriptions").select("stripe_customer_id").eq("project_id", input.projectId).eq("client_organization_id", context.client.id).maybeSingle();
    if (!row.data?.stripe_customer_id) throw new ApiError("Choose a paid plan before opening billing management.", 409, "BILLING_ACCOUNT_REQUIRED");
    const payload=await stripeForm<{url?:string;error?:{message?:string}}>("/v1/billing_portal/sessions",new URLSearchParams({customer:row.data.stripe_customer_id,return_url:`${appBaseUrl()}/portal/client`}),`retail-portal-${input.projectId}-${request.headers.get("idempotency-key")!}`);
    if (!payload.url) throw new ApiError("Stripe could not open billing management.", 502, "BILLING_PROVIDER_FAILED");
    return Response.json({ ok: true, url: payload.url });
  } catch (error) { return jsonError(error); }
}
