import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ApiError, logServerError, safeError } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { getLiveAdminClient } from "@/lib/live/identity";
import { planEntitlements } from "@/lib/agent-service/catalog";
import { agentCapacityAddOn } from "@/lib/agent-service/catalog";
import {FOUNDING_BETA_OFFER_KEY,foundingBetaProgram,isFoundingBetaOffer,isRetailBillingPlanKey,retailBillingPlans} from "@/lib/billing/catalog";
import {agencyBillingPlans,isAgencyBillingPlanKey} from "@/lib/billing/agency-catalog";
import {applyRetailWorkspaceBillingState} from "@/lib/billing/retail-workspace";
import {claimWebhookEvent,completeWebhookEvent,failWebhookEvent} from "@/lib/webhooks/inbox";

type StripeObject = { id: string; status?: string; payment_status?: string; amount_total?: number; currency?: string; customer?: string; subscription?: string; cancel_at_period_end?: boolean; current_period_end?: number; metadata?: Record<string,string> };
type StripeEvent = { id: string; type: string; created: number; data: { object: StripeObject } };

async function applyAgencySubscriptionState(db:ReturnType<typeof getLiveAdminClient>,agencyId:string,status:string){
  const subscription=await db.from("agency_subscriptions").select("included_client_limit,included_scale_client_limit").eq("agency_id",agencyId).maybeSingle();
  if(!subscription.data)return;
  if(!["active","trialing"].includes(status)){
    await db.from("agent_service_enrollments").update({status:"paused",pause_reason:"Agency billing is not active",worker_id:null,locked_at:null,lock_expires_at:null,updated_at:new Date().toISOString()}).eq("agency_id",agencyId).eq("billing_owner","agency").in("status",["trialing","active"]);
    return;
  }
  const enrollments=await db.from("agent_service_enrollments").select("id,plan_key,status,pause_reason,created_at").eq("agency_id",agencyId).eq("billing_owner","agency").order("created_at",{ascending:true});
  let active=0,scale=0;
  for(const enrollment of enrollments.data??[]){
    const billingPaused=enrollment.status==="paused"&&["Agency subscription required","Agency billing is not active","Agency plan capacity exceeded"].includes(enrollment.pause_reason??"");
    if(!["trialing","active"].includes(enrollment.status)&&!billingPaused)continue;
    const isScale=enrollment.plan_key==="agency_scale",allowed=active<Number(subscription.data.included_client_limit)&&(!isScale||scale<Number(subscription.data.included_scale_client_limit));
    await db.from("agent_service_enrollments").update(allowed?{status:"active",pause_reason:null,next_cycle_at:new Date().toISOString(),updated_at:new Date().toISOString()}:{status:"paused",pause_reason:"Agency plan capacity exceeded",worker_id:null,locked_at:null,lock_expires_at:null,updated_at:new Date().toISOString()}).eq("id",enrollment.id);
    if(allowed){active+=1;if(isScale)scale+=1;}
  }
}

function verify(payload: string, header: string | null) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new ApiError("Stripe webhook verification is not configured.", 503, "NOT_CONFIGURED");
  if (!header) throw new ApiError("Stripe webhook signature is missing.", 401, "INVALID_WEBHOOK_SIGNATURE");
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
  try {
    const raw = await request.text(); verify(raw, request.headers.get("stripe-signature"));
    const event = JSON.parse(raw) as StripeEvent, object = event.data.object, db = getLiveAdminClient();
    const inbox=await claimWebhookEvent(db,{provider:"stripe",deliveryId:event.id,eventType:event.type,payloadHash:createHash("sha256").update(raw).digest("hex"),payload:{objectId:object.id}});
    if(inbox.duplicate)return Response.json({ok:true,duplicate:true});
    try {
      const projectId = object.metadata?.project_id,kind=object.metadata?.kind;
      const handled=event.type==="checkout.session.completed"||event.type==="customer.subscription.updated"||event.type==="customer.subscription.deleted";
      if(event.type==="checkout.session.completed"&&kind==="agency_subscription"){
      const agencyId=object.metadata?.agency_id,planKey=object.metadata?.plan_key;
      if(!agencyId||!isAgencyBillingPlanKey(planKey)||!object.customer||!object.subscription)throw new ApiError("Agency checkout metadata is incomplete.",409,"PAYMENT_VERIFICATION_FAILED");
      const plan=agencyBillingPlans[planKey],beta=isFoundingBetaOffer(object.metadata?.offer_key),expectedAmount=beta?plan.beta.priceCents:plan.priceCents;
      if(object.payment_status!=="paid"||object.currency!=="usd"||Number(object.amount_total)!==expectedAmount||Number(object.metadata?.expected_amount_cents)!==expectedAmount)throw new ApiError("The agency subscription payment could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
      let offerEndsAt:string|null=null;
      if(beta){const reservationId=object.metadata?.beta_reservation_id;if(!reservationId)throw new ApiError("The agency beta reservation is missing.",409,"PAYMENT_VERIFICATION_FAILED");const activated=await db.rpc("activate_beta_offer",{p_reservation_id:reservationId,p_checkout_session_id:object.id,p_customer_id:object.customer,p_subscription_id:object.subscription});if(activated.error)throw new ApiError("The agency Founding Beta enrollment could not be activated. Apply migration 0035.",503,"DATABASE_BINDING_FAILED");offerEndsAt=(activated.data as {endsAt?:string})?.endsAt??null;}
      const updated=await db.from("agency_subscriptions").upsert({agency_id:agencyId,plan_key:planKey,status:"active",price_cents:plan.priceCents,included_client_limit:plan.includedClients,included_scale_client_limit:plan.includedScaleClients,stripe_customer_id:object.customer,stripe_subscription_id:object.subscription,offer_key:beta?FOUNDING_BETA_OFFER_KEY:null,offer_price_cents:beta?plan.beta.priceCents:null,offer_started_at:beta?new Date().toISOString():null,offer_ends_at:offerEndsAt,beta_redeemed_at:beta?new Date().toISOString():undefined,updated_at:new Date().toISOString()},{onConflict:"agency_id"});
      if(updated.error)throw new ApiError("The agency subscription could not be saved. Apply migration 0029.",503,"DATABASE_BINDING_FAILED");
      await applyAgencySubscriptionState(db,agencyId,"active");
    }else if (event.type === "checkout.session.completed") {
      if(!projectId)throw new ApiError("Stripe checkout metadata is incomplete.",409,"PAYMENT_VERIFICATION_FAILED");
      if(kind==="agent_capacity"){
        const enrollmentId=object.metadata?.enrollment_id,units=Number(object.metadata?.capacity_units),expected=units*agentCapacityAddOn.priceCents;
        if(!Number.isInteger(units)||units<1||units>20||Number(object.metadata?.unit_price_cents)!==agentCapacityAddOn.priceCents||Number(object.metadata?.provider_budget_per_unit)!==agentCapacityAddOn.providerBudgetPerAction)throw new ApiError("The paid capacity metadata could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
        if(object.payment_status!=="paid"||object.currency!=="usd"||Number(object.amount_total)!==expected)throw new ApiError("The capacity payment could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
        if(!enrollmentId)throw new ApiError("The paid capacity purchase is missing its enrollment.",409,"PAYMENT_VERIFICATION_FAILED");
        const credited=await db.rpc("credit_agent_capacity_purchase",{p_enrollment_id:enrollmentId,p_project_id:projectId,p_units:units,p_provider_budget_per_unit:agentCapacityAddOn.providerBudgetPerAction,p_stripe_event_id:event.id,p_amount_paid_cents:Number(object.amount_total)});
        if(credited.error)throw new ApiError("Paid capacity could not be credited. Apply migration 0028.",503,"DATABASE_BINDING_FAILED");
      }else{
        const planKey=object.metadata?.plan_key;
        if(!isRetailBillingPlanKey(planKey)||!object.customer||!object.subscription)throw new ApiError("The checkout plan or Stripe subscription binding could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
        const plan=retailBillingPlans[planKey],priceCents=plan.priceCents,beta=isFoundingBetaOffer(object.metadata?.offer_key),expectedAmount=beta?plan.beta.priceCents:priceCents;
        if(object.payment_status!=="paid"||object.currency!=="usd"||Number(object.amount_total)!==expectedAmount||Number(object.metadata?.expected_amount_cents)!==expectedAmount)throw new ApiError("The subscription payment could not be verified.",409,"PAYMENT_VERIFICATION_FAILED");
        let offerEndsAt:string|null=null;
        if(beta){const reservationId=object.metadata?.beta_reservation_id;if(!reservationId||!object.customer||!object.subscription)throw new ApiError("The business beta reservation is incomplete.",409,"PAYMENT_VERIFICATION_FAILED");const activated=await db.rpc("activate_beta_offer",{p_reservation_id:reservationId,p_checkout_session_id:object.id,p_customer_id:object.customer,p_subscription_id:object.subscription});if(activated.error)throw new ApiError("The business Founding Beta enrollment could not be activated. Apply migration 0035.",503,"DATABASE_BINDING_FAILED");offerEndsAt=(activated.data as {endsAt?:string})?.endsAt??null;}
        const savedSubscription=await db.from("client_subscriptions").update({ plan_key: planKey, price_cents: priceCents, stripe_customer_id: object.customer, stripe_subscription_id: object.subscription, status: "active", trial_ends_at: null,offer_key:beta?FOUNDING_BETA_OFFER_KEY:null,offer_price_cents:beta?plan.beta.priceCents:null,offer_started_at:beta?new Date().toISOString():null,offer_ends_at:offerEndsAt,beta_redeemed_at:beta?new Date().toISOString():undefined, updated_at: new Date().toISOString() }).eq("project_id", projectId).select("id").maybeSingle();
        if(savedSubscription.error||!savedSubscription.data)throw new ApiError("The paid business subscription could not be bound to its project.",503,"DATABASE_BINDING_FAILED");
        const project=await db.from("seo_projects").select("agency_id,client_organization_id").eq("id",projectId).maybeSingle();
        if(project.error||!project.data)throw new ApiError("The paid business project could not be resolved.",503,"DATABASE_BINDING_FAILED");
        const client=await db.from("clients").select("id").eq("agency_id",project.data.agency_id).eq("organization_id",project.data.client_organization_id).maybeSingle();
        if(client.error||!client.data)throw new ApiError("The paid business entitlement could not resolve its client record.",503,"DATABASE_BINDING_FAILED");
        const entitlement=planEntitlements(planKey),serviceMode=planKey==="pro"||planKey==="autopilot_plus"?"managed_agent":"copilot";
        const measurementEndsAt=beta?new Date(Date.now()+foundingBetaProgram.measurementWindowDays*86_400_000).toISOString():null;
        const enrollment=await db.from("agent_service_enrollments").upsert({agency_id:project.data.agency_id,client_organization_id:project.data.client_organization_id,client_id:client.data.id,project_id:projectId,service_mode:serviceMode,operator_brand:"hdseo",approval_owner:"client",billing_owner:"client",plan_key:planKey,status:"active",monthly_action_limit:entitlement.monthlyActionLimit,monthly_major_page_limit:entitlement.monthlyMajorPageLimit,monthly_provider_budget:beta?plan.beta.includedProviderBudgetDollars:entitlement.monthlyProviderBudget,monthly_human_review_minutes:entitlement.humanReviewMinutes,cycle_cadence_hours:entitlement.cycleCadenceHours,next_cycle_at:new Date().toISOString(),stripe_customer_id:object.customer,stripe_subscription_id:object.subscription,subscription_id:savedSubscription.data.id,minimum_contribution_margin_pct:beta?foundingBetaProgram.targetContributionMarginPercent:null,all_in_delivery_cost_ceiling:beta?plan.beta.maxAllInCostCents/100:null,all_in_delivery_cost_used:beta?plan.beta.fixedDeliveryReserveCents/100:0,economics_policy:beta?{version:"founding_beta_25_v1",offerKey:FOUNDING_BETA_OFFER_KEY,offerEndsAt,measurementEndsAt,fixedDeliveryReserveDollars:plan.beta.fixedDeliveryReserveCents/100,includedProviderBudgetDollars:plan.beta.includedProviderBudgetDollars,targetContributionMarginPercent:foundingBetaProgram.targetContributionMarginPercent}: {},updated_at:new Date().toISOString()},{onConflict:"project_id"});
        if(enrollment.error)throw new ApiError("The paid service entitlement could not be activated. Apply migration 0049.",503,"DATABASE_BINDING_FAILED");
        await applyRetailWorkspaceBillingState(db,{agencyId:project.data.agency_id,projectId,status:"active"});
      }
    } else if ((event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") && object.id) {
      const status = event.type === "customer.subscription.deleted" ? "canceled" : object.status === "active" || object.status === "trialing" ? object.status : object.status === "past_due" ? "past_due" : "paused";
      if(object.metadata?.kind==="agency_subscription"){
        const metadata=object.metadata,agencyId=metadata.agency_id,planKey=metadata.plan_key;
        if(!agencyId||!isAgencyBillingPlanKey(planKey))throw new ApiError("Agency subscription metadata is invalid.",409,"PAYMENT_VERIFICATION_FAILED");
        const plan=agencyBillingPlans[planKey];
        await db.from("agency_subscriptions").update({plan_key:planKey,status,price_cents:plan.priceCents,included_client_limit:plan.includedClients,included_scale_client_limit:plan.includedScaleClients,cancel_at_period_end:object.cancel_at_period_end??false,current_period_end:object.current_period_end?new Date(object.current_period_end*1000).toISOString():null,updated_at:new Date().toISOString()}).eq("stripe_subscription_id",object.id);
        await applyAgencySubscriptionState(db,agencyId,status);
      }else{
        const retailSubscription=await db.from("client_subscriptions").select("agency_id,project_id,plan_key,offer_ends_at").eq("stripe_subscription_id",object.id).maybeSingle();
        await db.from("client_subscriptions").update({ status, cancel_at_period_end: object.cancel_at_period_end ?? false, current_period_end: object.current_period_end ? new Date(object.current_period_end*1000).toISOString() : null, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", object.id);
        const offerActive=Boolean(retailSubscription.data?.offer_ends_at&&new Date(retailSubscription.data.offer_ends_at).getTime()>Date.now());
        const standardEntitlement=planEntitlements(retailSubscription.data?.plan_key??"starter");
        await db.from("agent_service_enrollments").update({status,next_cycle_at:status==="active"||status==="trialing"?new Date().toISOString():undefined,pause_reason:status==="active"||status==="trialing"?null:"Billing is not active",...(offerActive?{}:{monthly_provider_budget:standardEntitlement.monthlyProviderBudget,minimum_contribution_margin_pct:null,all_in_delivery_cost_ceiling:null,all_in_delivery_cost_used:0,economics_policy:{}}),updated_at:new Date().toISOString()}).eq("stripe_subscription_id",object.id);
        if(retailSubscription.data)await applyRetailWorkspaceBillingState(db,{agencyId:retailSubscription.data.agency_id,projectId:retailSubscription.data.project_id,status});
      }
    }
      await completeWebhookEvent(db,{eventId:inbox.eventId,status:handled?"processed":"ignored"});
      return Response.json({ok:true,replayed:inbox.replayed});
    } catch (error) {
      const safe=safeError(error);
      await failWebhookEvent(db,{eventId:inbox.eventId,code:safe.body.error.code,message:safe.body.error.message});
      logServerError("stripe_webhook_failed",error,{referenceId:safe.body.error.referenceId,provider:"stripe"});
      return Response.json(safe.body,{status:safe.status});
    }
  } catch (error) {
    const safe=safeError(error);
    logServerError("stripe_webhook_rejected",error,{referenceId:safe.body.error.referenceId,provider:"stripe"});
    return Response.json(safe.body,{status:safe.status});
  }
}
