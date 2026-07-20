import {z} from "zod";
import {ApiError,jsonError} from "@/lib/api/errors";
import {parseJson} from "@/lib/api/request";
import {requireLiveAgency} from "@/lib/auth/live-tenant";
import {agencyBillingPlans} from "@/lib/billing/agency-catalog";
import {FOUNDING_BETA_OFFER_KEY,foundingBetaProgram,isFoundingBetaOffer} from "@/lib/billing/catalog";
import {ensureOneTimeAmountCoupon,stripeForm} from "@/lib/billing/stripe";
import {appBaseUrl,env} from "@/lib/config/env";

const schema=z.object({planKey:z.enum(["launch","growth","scale"]),offerKey:z.literal(FOUNDING_BETA_OFFER_KEY).optional()});

export async function POST(request:Request){
  try{
    const input=await parseJson(request,schema),requestKey=request.headers.get("idempotency-key")!,context=await requireLiveAgency({permission:"billing.manage"}),plan=agencyBillingPlans[input.planKey],beta=isFoundingBetaOffer(input.offerKey);
    const priceId=input.planKey==="launch"?env.STRIPE_PRICE_AGENCY_LAUNCH_MONTHLY:input.planKey==="growth"?env.STRIPE_PRICE_AGENCY_GROWTH_MONTHLY:env.STRIPE_PRICE_AGENCY_SCALE_MONTHLY;
    if(!priceId)throw new ApiError(`${plan.label} checkout is not configured.`,503,"NOT_CONFIGURED");
    const existing=await context.db.from("agency_subscriptions").select("id,stripe_customer_id,stripe_subscription_id,status,beta_redeemed_at").eq("agency_id",context.agencyId).maybeSingle();
    if(existing.data?.stripe_subscription_id&&["trialing","active","past_due"].includes(existing.data.status))throw new ApiError("Use Manage billing to change an active agency subscription.",409,"BILLING_PORTAL_REQUIRED");
    if(beta&&existing.data?.beta_redeemed_at)throw new ApiError("This agency has already used its Founding Beta offer.",409,"BETA_ALREADY_REDEEMED");
    if(beta&&Date.now()>new Date(foundingBetaProgram.enrollmentClosesAt).getTime())throw new ApiError("Founding Beta enrollment is closed.",409,"BETA_ENROLLMENT_CLOSED");
    let reservationId:string|null=null;
    try{
      let couponId:string|null=null;
      if(beta){
        const reserved=await context.db.rpc("reserve_beta_offer",{p_offer_key:FOUNDING_BETA_OFFER_KEY,p_audience:"agency",p_agency_id:context.agencyId,p_client_organization_id:null,p_project_id:null,p_plan_key:input.planKey,p_price_cents:plan.beta.priceCents,p_standard_price_cents:plan.priceCents,p_max_all_in_cost_cents:plan.beta.maxAllInCostCents,p_included_founder_minutes:plan.beta.includedFounderMinutes,p_capacity:plan.beta.enrollmentLimit,p_duration_days:plan.beta.durationDays});
        if(reserved.error)throw new ApiError("Founding Beta enrollment could not be reserved. Apply migration 0035.",503,"DATABASE_BINDING_FAILED");
        const claim=reserved.data as {allowed?:boolean;reason?:string;reservationId?:string};
        if(!claim.allowed)throw new ApiError(claim.reason==="BETA_TIER_FULL"?"This agency Founding Beta tier is full. Choose another tier or the standard plan.":"This agency has already used its Founding Beta offer.",409,claim.reason==="BETA_TIER_FULL"?"BETA_TIER_FULL":"BETA_ALREADY_REDEEMED");
        reservationId=claim.reservationId??null;
        if(!reservationId)throw new ApiError("Founding Beta reservation is incomplete.",503,"DATABASE_BINDING_FAILED");
        couponId=await ensureOneTimeAmountCoupon({id:`hdseo_${FOUNDING_BETA_OFFER_KEY}_agency_${input.planKey}`,name:`HD SEO ${plan.label} Founding Beta`,amountOffCents:plan.priceCents-plan.beta.priceCents});
      }
      let customerId=existing.data?.stripe_customer_id as string|null;
      if(!customerId){
        const customer=await stripeForm<{id?:string;error?:{message?:string}}>("/v1/customers",new URLSearchParams({email:context.email,"metadata[agency_id]":context.agencyId,"metadata[kind]":"agency"}),`agency-customer-${context.agencyId}-${requestKey}`);
        if(!customer.id)throw new ApiError("Stripe did not return an agency customer.",502,"BILLING_PROVIDER_FAILED");
        customerId=customer.id;
      }
      const saved=await context.db.from("agency_subscriptions").upsert({agency_id:context.agencyId,plan_key:input.planKey,status:"pending",price_cents:plan.priceCents,included_client_limit:plan.includedClients,included_scale_client_limit:plan.includedScaleClients,stripe_customer_id:customerId,updated_at:new Date().toISOString()},{onConflict:"agency_id"});
      if(saved.error)throw new ApiError("Agency billing could not be initialized. Apply migration 0035.",503,"DATABASE_BINDING_FAILED");
      const base=appBaseUrl(),expectedAmount=beta?plan.beta.priceCents:plan.priceCents,body=new URLSearchParams({customer:customerId,mode:"subscription",success_url:`${base}/portal/agency?tab=Billing&billing=success`,cancel_url:`${base}/portal/agency?tab=Billing&billing=canceled`,client_reference_id:context.agencyId,"line_items[0][price]":priceId,"line_items[0][quantity]":"1","metadata[kind]":"agency_subscription","metadata[agency_id]":context.agencyId,"metadata[plan_key]":input.planKey,"metadata[expected_amount_cents]":String(expectedAmount),"subscription_data[metadata][kind]":"agency_subscription","subscription_data[metadata][agency_id]":context.agencyId,"subscription_data[metadata][plan_key]":input.planKey});
      if(beta&&couponId&&reservationId){body.set("discounts[0][coupon]",couponId);body.set("metadata[offer_key]",FOUNDING_BETA_OFFER_KEY);body.set("metadata[beta_reservation_id]",reservationId);body.set("metadata[max_all_in_cost_cents]",String(plan.beta.maxAllInCostCents));body.set("metadata[included_founder_minutes]",String(plan.beta.includedFounderMinutes));body.set("subscription_data[metadata][offer_key]",FOUNDING_BETA_OFFER_KEY);}
      const session=await stripeForm<{id?:string;url?:string;error?:{message?:string}}>("/v1/checkout/sessions",body,`agency-checkout-${context.agencyId}-${requestKey}`);
      if(!session.id||!session.url)throw new ApiError("Stripe did not return an agency checkout URL.",502,"BILLING_PROVIDER_FAILED");
      if(reservationId){const attached=await context.db.rpc("attach_beta_checkout",{p_reservation_id:reservationId,p_checkout_session_id:session.id});if(attached.error)throw new ApiError("Founding Beta checkout could not be attached to its reservation.",503,"DATABASE_BINDING_FAILED");}
      return Response.json({ok:true,url:session.url});
    }catch(error){if(reservationId)await context.db.rpc("release_beta_offer",{p_reservation_id:reservationId});throw error;}
  }catch(error){return jsonError(error);}
}
