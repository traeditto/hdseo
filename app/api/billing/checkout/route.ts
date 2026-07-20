import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { resolveClientContext } from "@/lib/auth/context";
import { appBaseUrl, env } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";

const schema = z.object({
  projectId: z.string().uuid(),
  planKey: z.enum(["starter", "growth", "pro", "autopilot_plus"]),
});
async function stripe(path: string, body: URLSearchParams) {
  if (!env.STRIPE_SECRET_KEY) throw new ApiError("Stripe billing is not configured yet.", 503, "NOT_CONFIGURED");
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json() as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok) throw new ApiError(payload.error?.message ?? "Stripe could not create the secure checkout.", 502, "BILLING_PROVIDER_FAILED");
  return payload;
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, schema);
    const context = await resolveClientContext({ projectId: input.projectId, requireProject: true });
    if (context.role !== "client_admin") throw new ApiError("Only the business owner can change the plan.", 403, "ROLE_FORBIDDEN");
    const priceId = {
      starter: env.STRIPE_PRICE_STARTER_MONTHLY,
      growth: env.STRIPE_PRICE_GROWTH_MONTHLY,
      pro: env.STRIPE_PRICE_PRO_MONTHLY,
      autopilot_plus: env.STRIPE_PRICE_AUTOPILOT_PLUS_MONTHLY,
    }[input.planKey];
    if (!priceId) throw new ApiError(`The ${input.planKey} Stripe price is not configured.`, 503, "NOT_CONFIGURED");
    const db = getLiveAdminClient();
    const subscription = await db.from("client_subscriptions").select("id,stripe_customer_id").eq("project_id", input.projectId).eq("client_organization_id", context.client.id).maybeSingle();
    if (subscription.error || !subscription.data) throw new ApiError("The retail subscription record is unavailable. Apply migration 0022.", 503, "DATABASE_BINDING_FAILED");
    let customerId = subscription.data.stripe_customer_id as string | null;
    if (!customerId) {
      const customerBody = new URLSearchParams({ email: context.user.email, "metadata[agency_id]": context.agency.id, "metadata[client_id]": context.client.id, "metadata[project_id]": input.projectId });
      const customer = await stripe("/v1/customers", customerBody);
      if (!customer.id) throw new ApiError("Stripe did not return a customer ID.", 502, "BILLING_PROVIDER_FAILED");
      customerId = customer.id;
      await db.from("client_subscriptions").update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }).eq("id", subscription.data.id);
    }
    const base = appBaseUrl();
    const body = new URLSearchParams({
      customer: customerId,
      mode: "subscription",
      success_url: `${base}/portal/client?billing=success`,
      cancel_url: `${base}/portal/client?billing=canceled`,
      client_reference_id: input.projectId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "metadata[agency_id]": context.agency.id,
      "metadata[client_id]": context.client.id,
      "metadata[project_id]": input.projectId,
      "metadata[plan_key]": input.planKey,
      "subscription_data[metadata][agency_id]": context.agency.id,
      "subscription_data[metadata][client_id]": context.client.id,
      "subscription_data[metadata][project_id]": input.projectId,
      "subscription_data[metadata][plan_key]": input.planKey,
      allow_promotion_codes: "true",
    });
    const session = await stripe("/v1/checkout/sessions", body);
    if (!session.url) throw new ApiError("Stripe did not return a checkout URL.", 502, "BILLING_PROVIDER_FAILED");
    return Response.json({ ok: true, url: session.url });
  } catch (error) { return jsonError(error); }
}
