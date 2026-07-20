import {z} from "zod";
import {ApiError,jsonError} from "@/lib/api/errors";
import {parseJson} from "@/lib/api/request";
import {requireLiveAgency} from "@/lib/auth/live-tenant";
import {agencyBillingPlans} from "@/lib/billing/agency-catalog";
import {env} from "@/lib/config/env";
import {stripeForm} from "@/lib/billing/stripe";

const schema=z.object({planKey:z.enum(["launch","growth","scale"])});

export async function POST(request:Request){
  try{
    const input=await parseJson(request,schema),context=await requireLiveAgency({permission:"billing.manage"}),plan=agencyBillingPlans[input.planKey];
    if(!env.STRIPE_SECRET_KEY)throw new ApiError("Stripe billing is not configured.",503,"NOT_CONFIGURED");
    const priceId=input.planKey==="launch"?env.STRIPE_PRICE_AGENCY_LAUNCH_MONTHLY:input.planKey==="growth"?env.STRIPE_PRICE_AGENCY_GROWTH_MONTHLY:env.STRIPE_PRICE_AGENCY_SCALE_MONTHLY;
    if(!priceId)throw new ApiError(`${plan.label} checkout is not configured.`,503,"NOT_CONFIGURED");
    const subscription=await context.db.from("agency_subscriptions").select("stripe_subscription_id,status").eq("agency_id",context.agencyId).maybeSingle();
    if(!subscription.data?.stripe_subscription_id||!["trialing","active","past_due"].includes(subscription.data.status))throw new ApiError("Start an agency subscription before changing tiers.",409,"SUBSCRIPTION_REQUIRED");
    const usage=await context.db.from("agent_service_enrollments").select("plan_key").eq("agency_id",context.agencyId).eq("billing_owner","agency").in("status",["trialing","active"]);
    const active=usage.data?.length??0,scale=usage.data?.filter(row=>row.plan_key==="agency_scale").length??0;
    if(active>plan.includedClients||scale>plan.includedScaleClients)throw new ApiError(`Move clients within ${plan.label}'s ${plan.includedClients}-client and ${plan.includedScaleClients}-Scale-seat limits before downgrading.`,409,"PLAN_CAPACITY_CONFLICT");
    const current=await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.data.stripe_subscription_id)}`,{headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`}}),payload=await current.json() as {items?:{data?:Array<{id:string}>};error?:{message?:string}};
    const itemId=payload.items?.data?.[0]?.id;
    if(!current.ok||!itemId)throw new ApiError(payload.error?.message??"Stripe could not load the agency subscription.",502,"BILLING_PROVIDER_FAILED");
    const body=new URLSearchParams({"items[0][id]":itemId,"items[0][price]":priceId,proration_behavior:"create_prorations","metadata[kind]":"agency_subscription","metadata[agency_id]":context.agencyId,"metadata[plan_key]":input.planKey});
    await stripeForm(`/v1/subscriptions/${encodeURIComponent(subscription.data.stripe_subscription_id)}`,body,`agency-plan-${subscription.data.stripe_subscription_id}-${request.headers.get("idempotency-key")!}`);
    await context.db.from("agency_subscriptions").update({plan_key:input.planKey,price_cents:plan.priceCents,included_client_limit:plan.includedClients,included_scale_client_limit:plan.includedScaleClients,updated_at:new Date().toISOString()}).eq("agency_id",context.agencyId);
    return Response.json({ok:true});
  }catch(error){return jsonError(error);}
}
