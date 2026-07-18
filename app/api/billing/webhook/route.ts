import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ApiError, jsonError, logServerError } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";

type StripeObject = { id: string; status?: string; customer?: string; subscription?: string; cancel_at_period_end?: boolean; current_period_end?: number; metadata?: Record<string,string> };
type StripeEvent = { id: string; type: string; created: number; data: { object: StripeObject } };

function verify(payload: string, header: string | null) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) throw new ApiError("Stripe webhook verification is not configured.", 503, "NOT_CONFIGURED");
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2) as [string,string]));
  const timestamp = Number(parts.t), signature = parts.v1;
  if (!timestamp || !signature || Math.abs(Date.now()/1000-timestamp)>300) throw new ApiError("Stripe webhook timestamp is invalid.", 401, "WEBHOOK_REPLAY_REJECTED");
  const expected = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  const left = Buffer.from(signature, "hex"), right = Buffer.from(expected, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new ApiError("Stripe webhook signature is invalid.", 401, "INVALID_WEBHOOK_SIGNATURE");
}

export async function POST(request: Request) {
  const referenceId = crypto.randomUUID();
  try {
    const raw = await request.text(); verify(raw, request.headers.get("stripe-signature"));
    const event = JSON.parse(raw) as StripeEvent, object = event.data.object, db = getLiveAdminClient();
    const stored = await db.from("webhook_events").upsert({ provider: "stripe", delivery_id: event.id, event_type: event.type, signature_valid: true, status: "processing", payload_hash: createHash("sha256").update(raw).digest("hex"), payload: { objectId: object.id }, received_at: new Date(event.created*1000).toISOString() }, { onConflict: "provider,delivery_id" }).select("id,status").single();
    if (stored.data?.status === "processed") return Response.json({ ok: true, duplicate: true });
    const projectId = object.metadata?.project_id;
    if (event.type === "checkout.session.completed" && projectId) {
      const planKey=object.metadata?.plan_key,priceCents=planKey==="starter"?4900:planKey==="growth"?9900:planKey==="pro"?14900:0;
      await db.from("client_subscriptions").update({ plan_key: planKey, price_cents: priceCents, stripe_customer_id: object.customer, stripe_subscription_id: object.subscription, status: "active", trial_ends_at: null, updated_at: new Date().toISOString() }).eq("project_id", projectId);
    } else if ((event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") && object.id) {
      const status = event.type === "customer.subscription.deleted" ? "canceled" : object.status === "active" || object.status === "trialing" ? object.status : object.status === "past_due" ? "past_due" : "paused";
      await db.from("client_subscriptions").update({ status, cancel_at_period_end: object.cancel_at_period_end ?? false, current_period_end: object.current_period_end ? new Date(object.current_period_end*1000).toISOString() : null, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", object.id);
    }
    if (stored.data?.id) await db.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", stored.data.id);
    return Response.json({ ok: true });
  } catch (error) { logServerError("stripe_webhook_failed", error, { referenceId }); return jsonError(error); }
}
