import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { resolveClientContext } from "@/lib/auth/context";
import { appBaseUrl, env } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";
import {FOUNDING_BETA_OFFER_KEY,foundingBetaProgram,isFoundingBetaOffer,retailBillingPlans} from "@/lib/billing/catalog";
import {ensureOneTimeAmountCoupon,stripeForm} from "@/lib/billing/stripe";

const schema = z.object({
  projectId: z.string().uuid(),
  planKey: z.enum(["starter", "growth", "pro", "autopilot_plus"]),
  offerKey:z.literal(FOUNDING_BETA_OFFER_KEY).optional(),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, schema);
    const context = await resolveClientContext({ projectId: input.projectId, requireProject: true });
    if (context.role !== "client_admin") throw new ApiError("Only the business owner can change the plan.", 403, "ROLE_FORBIDDEN");
    const plan=retailBillingPlans[input.planKey],beta=isFoundingBetaOffer(input.offerKey);
    const priceId = {
      starter: env.STRIPE_PRICE_STARTER_MONTHLY,
      growth: env.STRIPE_PRICE_GROWTH_MONTHLY,
      pro: env.STRIPE_PRICE_PRO_MONTHLY,
      autopilot_plus: env.STRIPE_PRICE_AUTOPILOT_PLUS_MONTHLY,
    }[input.planKey];
    if (!priceId) throw new ApiError(`The ${input.planKey} Stripe price is not configured.`, 503, "NOT_CONFIGURED");
    const db = getLiveAdminClient();
    const subscription = await db.from("client_subscriptions").select("id,status,plan_key,stripe_customer_id,stripe_subscription_id,beta_redeemed_at").eq("project_id", input.projectId).eq("client_organization_id", context.client.id).maybeSingle();
    if (subscription.error || !subscription.data) throw new ApiError("The retail subscription record is unavailable. Apply migration 0035.", 503, "DATABASE_BINDING_FAILED");
    if(subscription.data.stripe_subscription_id&&["trialing","active","past_due"].includes(subscription.data.status))throw new ApiError("Use Manage billing to change an active subscription.",409,"BILLING_PORTAL_REQUIRED");
    if(beta&&subscription.data.beta_redeemed_at)throw new ApiError("This website has already used its Founding Beta offer.",409,"BETA_ALREADY_REDEEMED");
    if(beta&&Date.now()>new Date(foundingBetaProgram.enrollmentClosesAt).getTime())throw new ApiError("Founding Beta enrollment is closed.",409,"BETA_ENROLLMENT_CLOSED");
    let reservationId:string|null=null;
    try{
      let couponId:string|null=null;
      if(beta){
        const reserved=await db.rpc("reserve_beta_offer",{p_offer_key:FOUNDING_BETA_OFFER_KEY,p_audience:"business",p_agency_id:context.agency.id,p_client_organization_id:context.client.id,p_project_id:input.projectId,p_plan_key:input.planKey,p_price_cents:plan.beta.priceCents,p_standard_price_cents:plan.priceCents,p_max_all_in_cost_cents:plan.beta.maxAllInCostCents,p_included_founder_minutes:plan.beta.includedFounderMinutes,p_capacity:plan.beta.enrollmentLimit,p_duration_days:plan.beta.durationDays});
        if(reserved.error)throw new ApiError("Founding Beta enrollment could not be reserved. Apply migration 0035.",503,"DATABASE_BINDING_FAILED");
        const claim=reserved.data as {allowed?:boolean;reason?:string;reservationId?:string};
        if(!claim.allowed)throw new ApiError(claim.reason==="BETA_TIER_FULL"?"This Founding Beta tier is full. Choose another tier or join the standard plan.":"This website has already used its Founding Beta offer.",409,claim.reason==="BETA_TIER_FULL"?"BETA_TIER_FULL":"BETA_ALREADY_REDEEMED");
        reservationId=claim.reservationId??null;
        if(!reservationId)throw new ApiError("Founding Beta reservation is incomplete.",503,"DATABASE_BINDING_FAILED");
        couponId=await ensureOneTimeAmountCoupon({id:`hdseo_${FOUNDING_BETA_OFFER_KEY}_business_${input.planKey}`,name:`HD SEO ${plan.label} Founding Beta`,amountOffCents:plan.priceCents-plan.beta.priceCents});
      }
      let customerId = subscription.data.stripe_customer_id as string | null;
      if (!customerId) {
        const customerBody = new URLSearchParams({ email: context.user.email, "metadata[agency_id]": context.agency.id, "metadata[client_id]": context.client.id, "metadata[project_id]": input.projectId });
        const customer = await stripeForm<{id?:string;error?:{message?:string}}>("/v1/customers", customerBody);
        if (!customer.id) throw new ApiError("Stripe did not return a customer ID.", 502, "BILLING_PROVIDER_FAILED");
        customerId = customer.id;
        await db.from("client_subscriptions").update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }).eq("id", subscription.data.id);
      }
      const base = appBaseUrl(),expectedAmount=beta?plan.beta.priceCents:plan.priceCents;
      const body = new URLSearchParams({customer: customerId,mode: "subscription",success_url: `${base}/portal/client?billing=success`,cancel_url: `${base}/portal/client?billing=canceled`,client_reference_id: input.projectId,"line_items[0][price]": priceId,"line_items[0][quantity]": "1","metadata[kind]":"retail_subscription","metadata[agency_id]": context.agency.id,"metadata[client_id]": context.client.id,"metadata[project_id]": input.projectId,"metadata[plan_key]": input.planKey,"metadata[expected_amount_cents]":String(expectedAmount),"subscription_data[metadata][kind]":"retail_subscription","subscription_data[metadata][agency_id]": context.agency.id,"subscription_data[metadata][client_id]": context.client.id,"subscription_data[metadata][project_id]": input.projectId,"subscription_data[metadata][plan_key]": input.planKey});
      if(beta&&couponId&&reservationId){body.set("discounts[0][coupon]",couponId);body.set("metadata[offer_key]",FOUNDING_BETA_OFFER_KEY);body.set("metadata[beta_reservation_id]",reservationId);body.set("metadata[max_all_in_cost_cents]",String(plan.beta.maxAllInCostCents));body.set("metadata[fixed_delivery_reserve_cents]",String(plan.beta.fixedDeliveryReserveCents));body.set("metadata[included_provider_budget_dollars]",String(plan.beta.includedProviderBudgetDollars));body.set("metadata[target_contribution_margin_percent]",String(foundingBetaProgram.targetContributionMarginPercent));body.set("metadata[measurement_window_days]",String(foundingBetaProgram.measurementWindowDays));body.set("metadata[included_founder_minutes]",String(plan.beta.includedFounderMinutes));body.set("subscription_data[metadata][offer_key]",FOUNDING_BETA_OFFER_KEY);}
      const session = await stripeForm<{id?:string;url?:string;error?:{message?:string}}>("/v1/checkout/sessions", body);
      if (!session.id||!session.url) throw new ApiError("Stripe did not return a checkout URL.", 502, "BILLING_PROVIDER_FAILED");
      if(reservationId){const attached=await db.rpc("attach_beta_checkout",{p_reservation_id:reservationId,p_checkout_session_id:session.id});if(attached.error)throw new ApiError("Founding Beta checkout could not be attached to its reservation.",503,"DATABASE_BINDING_FAILED");}
      return Response.json({ ok: true, url: session.url });
    }catch(error){if(reservationId)await db.rpc("release_beta_offer",{p_reservation_id:reservationId});throw error;}
  } catch (error) { return jsonError(error); }
}
