import {z} from "zod";
import {ApiError,jsonError} from "@/lib/api/errors";
import {parseJson} from "@/lib/api/request";
import {requireLiveAgency} from "@/lib/auth/live-tenant";
import {agencyBillingPlans} from "@/lib/billing/agency-catalog";
import {appBaseUrl,env} from "@/lib/config/env";

const schema=z.object({planKey:z.enum(["launch","growth","scale"])});

async function stripe(path:string,body:URLSearchParams){
  if(!env.STRIPE_SECRET_KEY)throw new ApiError("Stripe billing is not configured.",503,"NOT_CONFIGURED");
  const response=await fetch(`https://api.stripe.com${path}`,{method:"POST",headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,"content-type":"application/x-www-form-urlencoded"},body});
  const payload=await response.json() as {id?:string;url?:string;error?:{message?:string}};
  if(!response.ok)throw new ApiError(payload.error?.message??"Stripe could not create agency checkout.",502,"BILLING_PROVIDER_FAILED");
  return payload;
}

export async function POST(request:Request){
  try{
    const input=await parseJson(request,schema),context=await requireLiveAgency({permission:"billing.manage"}),plan=agencyBillingPlans[input.planKey];
    const priceId=input.planKey==="launch"?env.STRIPE_PRICE_AGENCY_LAUNCH_MONTHLY:input.planKey==="growth"?env.STRIPE_PRICE_AGENCY_GROWTH_MONTHLY:env.STRIPE_PRICE_AGENCY_SCALE_MONTHLY;
    if(!priceId)throw new ApiError(`${plan.label} checkout is not configured.`,503,"NOT_CONFIGURED");
    const existing=await context.db.from("agency_subscriptions").select("id,stripe_customer_id,stripe_subscription_id,status").eq("agency_id",context.agencyId).maybeSingle();
    if(existing.data?.stripe_subscription_id&&["trialing","active","past_due"].includes(existing.data.status))throw new ApiError("Use Manage billing to change an active agency subscription.",409,"BILLING_PORTAL_REQUIRED");
    let customerId=existing.data?.stripe_customer_id as string|null;
    if(!customerId){
      const customer=await stripe("/v1/customers",new URLSearchParams({email:context.email,"metadata[agency_id]":context.agencyId,"metadata[kind]":"agency"}));
      if(!customer.id)throw new ApiError("Stripe did not return an agency customer.",502,"BILLING_PROVIDER_FAILED");
      customerId=customer.id;
    }
    const saved=await context.db.from("agency_subscriptions").upsert({agency_id:context.agencyId,plan_key:input.planKey,status:"pending",price_cents:plan.priceCents,included_client_limit:plan.includedClients,included_scale_client_limit:plan.includedScaleClients,stripe_customer_id:customerId,updated_at:new Date().toISOString()},{onConflict:"agency_id"});
    if(saved.error)throw new ApiError("Agency billing could not be initialized. Apply migration 0029.",503,"DATABASE_BINDING_FAILED");
    const base=appBaseUrl(),body=new URLSearchParams({customer:customerId,mode:"subscription",success_url:`${base}/portal/agency?tab=Billing&billing=success`,cancel_url:`${base}/portal/agency?tab=Billing&billing=canceled`,client_reference_id:context.agencyId,"line_items[0][price]":priceId,"line_items[0][quantity]":"1","metadata[kind]":"agency_subscription","metadata[agency_id]":context.agencyId,"metadata[plan_key]":input.planKey,"subscription_data[metadata][kind]":"agency_subscription","subscription_data[metadata][agency_id]":context.agencyId,"subscription_data[metadata][plan_key]":input.planKey});
    const session=await stripe("/v1/checkout/sessions",body);
    if(!session.url)throw new ApiError("Stripe did not return an agency checkout URL.",502,"BILLING_PROVIDER_FAILED");
    return Response.json({ok:true,url:session.url});
  }catch(error){return jsonError(error);}
}
