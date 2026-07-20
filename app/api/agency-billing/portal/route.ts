import {ApiError,jsonError} from "@/lib/api/errors";
import {requireLiveAgency} from "@/lib/auth/live-tenant";
import {appBaseUrl,env} from "@/lib/config/env";
import {stripeForm} from "@/lib/billing/stripe";

export async function POST(request:Request){
  try{
    const context=await requireLiveAgency({permission:"billing.manage"});
    if(!env.STRIPE_SECRET_KEY)throw new ApiError("Stripe billing is not configured.",503,"NOT_CONFIGURED");
    const row=await context.db.from("agency_subscriptions").select("stripe_customer_id").eq("agency_id",context.agencyId).maybeSingle();
    if(!row.data?.stripe_customer_id)throw new ApiError("Choose an agency plan before opening billing management.",409,"BILLING_ACCOUNT_REQUIRED");
    const payload=await stripeForm<{url?:string;error?:{message?:string}}>("/v1/billing_portal/sessions",new URLSearchParams({customer:row.data.stripe_customer_id,return_url:`${appBaseUrl()}/portal/agency?tab=Billing`}),`agency-portal-${context.agencyId}-${request.headers.get("idempotency-key")!}`);
    if(!payload.url)throw new ApiError("Stripe could not open agency billing.",502,"BILLING_PROVIDER_FAILED");
    return Response.json({ok:true,url:payload.url});
  }catch(error){return jsonError(error);}
}
