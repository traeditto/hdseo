import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ApiError, jsonError, logServerError } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";
import { planEntitlements } from "@/lib/agent-service/catalog";
import { agentCapacityAddOn } from "@/lib/agent-service/catalog";
import { isRetailBillingPlanKey, retailBillingPlans } from "@/lib/billing/catalog";

type StripeObject = { id: string; status?: string; payment_status?: string; amount_total?: number; currency?: string; customer?: string; subscription?: string; cancel_at_period_end?: boolean; current_period_end?: number; metadata?: Record<string,string> };
type StripeEvent = { id: string; type: string; created: number; data: { object: StripeObject } };

function verify(payload: string, header: string | null) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) throw new ApiError("Stripe webhook verification is not configured.", 503, "NOT_CONFIGURED");
  const parts = header.split(",").map((part) => part.split("=", 2) as [string,string]);
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([,value]) => value);
  if (!timestamp || signatures.length === 0 || Math.abs(Date.now()/1000-timestamp)>300) throw new ApiError("Stripe webhook timestamp is invalid.", 401, "WEBHOOK_REPLAY_REJECTED");
  const expected = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  const right = Buffer.from(expected, "hex");
  const valid = signatures.some((signature) => { const left = Buffer.from(signature, "hex"); return left.length === right.length && timingSafeEqual(left, right); });
  if (!valid) throw new ApiError("Stripe webhook signature is invalid.", 401, "INVALID_WEBHOOK_SIGNATURE");
}

export async function POST(request: Request) {
  const referenceId = crypto.randomUUID();
  try {
    const raw = await request.text(); verify(raw, request.headers.get("stripe-signature"));
    const event = JSON.parse(raw) as StripeEvent, object = event.data.object, db = getLiveAdminClient();
    const stored = await db.from("webhook_events").upsert({ provider: "stripe", delivery_id: event.id, event_type: event.type, signature_valid: true, status: "processing", payload_hash: createHash("sha256").update(raw).digest("hex"), payload: { objectId: object.id }, received_at: new Date(event.created*1000).toISOString() }, { onConflict: "provider,delivery_id" }).select("id,status").single();
    if (stored.data?.status === "processed") return Response.json({ ok: true, duplicate: true });
    const projectId = object.metadata?.project_id;
    if (event.type === "checkout.session.completed" && !projectId) throw new ApiError("Stripe checkout metadata is incomplete.", 409, "PAYMENT_VERIFICATION_FAILED");
    if (event.type === "checkout.session.completed" && projectId) {
      if(object.metadata?.kind==="agent_capacity"){
        const enrollmentId=object.metadata.enrollment_id,units=Math.max(1,Number(object.metadata.capacity_units)||1),expected=units*agentCapacityAddOn.priceCents;
        if(object.payment_status!=="paid"||object.currency!=="usd"||Number(object.amount_total)!==expected)throw new ApiError("The capacity payment could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
        if(!enrollmentId)throw new ApiError("The paid capacity purchase is missing its enrollment.",409,"PAYMENT_VERIFICATION_FAILED");
        const credited=await db.rpc("credit_agent_capacity_purchase",{p_enrollment_id:enrollmentId,p_project_id:projectId,p_units:units,p_provider_budget_per_unit:agentCapacityAddOn.providerBudgetPerAction,p_stripe_event_id:event.id,p_amount_paid_cents:Number(object.amount_total)});
        if(credited.error)throw new ApiError("Paid capacity could not be credited. Apply migration 0028.",503,"DATABASE_BINDING_FAILED");
      }else{
        const planKey=object.metadata?.plan_key;
        if(!isRetailBillingPlanKey(planKey))throw new ApiError("The checkout plan could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
        const priceCents=retailBillingPlans[planKey].priceCents;
        if(object.payment_status!=="paid"||object.currency!=="usd"||Number(object.amount_total)!==priceCents)throw new ApiError("The subscription payment could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
        await db.from("client_subscriptions").update({ plan_key: planKey, price_cents: priceCents, stripe_customer_id: object.customer, stripe_subscription_id: object.subscription, status: "active", trial_ends_at: null, updated_at: new Date().toISOString() }).eq("project_id", projectId);
        if(planKey){const project=await db.from("seo_projects").select("agency_id,client_organization_id").eq("id",projectId).maybeSingle(),client=project.data?await db.from("clients").select("id").eq("agency_id",project.data.agency_id).eq("organization_id",project.data.client_organization_id).maybeSingle():{data:null},subscription=await db.from("client_subscriptions").select("id").eq("project_id",projectId).maybeSingle();if(project.data&&client.data){const plan=planEntitlements(planKey);await db.from("agent_service_enrollments").upsert({agency_id:project.data.agency_id,client_organization_id:project.data.client_organization_id,client_id:client.data.id,project_id:projectId,service_mode:planKey==="starter"?"copilot":"managed_agent",operator_brand:"hdseo",approval_owner:"client",billing_owner:"client",plan_key:planKey,status:"active",monthly_action_limit:plan.monthlyActionLimit,monthly_provider_budget:plan.monthlyProviderBudget,monthly_human_review_minutes:plan.humanReviewMinutes,cycle_cadence_hours:plan.cycleCadenceHours,next_cycle_at:new Date().toISOString(),stripe_customer_id:object.customer,stripe_subscription_id:object.subscription,subscription_id:subscription.data?.id??null,updated_at:new Date().toISOString()},{onConflict:"project_id"});}}
      }
    } else if ((event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") && object.id) {
      const status = event.type === "customer.subscription.deleted" ? "canceled" : object.status === "active" || object.status === "trialing" ? object.status : object.status === "past_due" ? "past_due" : "paused";
      await db.from("client_subscriptions").update({ status, cancel_at_period_end: object.cancel_at_period_end ?? false, current_period_end: object.current_period_end ? new Date(object.current_period_end*1000).toISOString() : null, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", object.id);
      await db.from("agent_service_enrollments").update({status,next_cycle_at:status==="active"||status==="trialing"?new Date().toISOString():undefined,pause_reason:status==="active"||status==="trialing"?null:"Billing is not active",updated_at:new Date().toISOString()}).eq("stripe_subscription_id",object.id);
    }
    if (stored.data?.id) await db.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", stored.data.id);
    return Response.json({ ok: true });
  } catch (error) { logServerError("stripe_webhook_failed", error, { referenceId }); return jsonError(error); }
}
