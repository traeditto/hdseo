import "server-only";

import {ApiError} from "@/lib/api/errors";
import {env} from "@/lib/config/env";

type StripeError={error?:{code?:string;message?:string}};
type StripeCoupon=StripeError&{id?:string;amount_off?:number;currency?:string;duration?:string;valid?:boolean};

async function stripeRequest<T extends StripeError>(path:string,init:RequestInit={}){
  if(!env.STRIPE_SECRET_KEY)throw new ApiError("Stripe billing is not configured.",503,"NOT_CONFIGURED");
  const response=await fetch(`https://api.stripe.com${path}`,{
    ...init,
    headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,...init.headers},
  });
  const payload=await response.json() as T;
  return {response,payload};
}

export async function stripeForm<T extends StripeError>(path:string,body:URLSearchParams,idempotencyKey?:string){
  const {response,payload}=await stripeRequest<T>(path,{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded",...(idempotencyKey?{"Idempotency-Key":idempotencyKey}:{})},
    body,
  });
  if(!response.ok)throw new ApiError(payload.error?.message??"Stripe could not complete the billing request.",502,"BILLING_PROVIDER_FAILED");
  return payload;
}

function assertCoupon(coupon:StripeCoupon,id:string,amountOffCents:number){
  if(coupon.id!==id||coupon.valid===false||coupon.duration!=="once"||coupon.currency!=="usd"||coupon.amount_off!==amountOffCents){
    throw new ApiError("The Founding Beta discount in Stripe does not match the approved offer. Billing was stopped before checkout.",503,"BETA_COUPON_MISMATCH");
  }
  return id;
}

export async function ensureOneTimeAmountCoupon(input:{id:string;name:string;amountOffCents:number}){
  if(input.amountOffCents<=0)throw new ApiError("The Founding Beta discount is invalid.",500,"BETA_CONFIGURATION_INVALID");
  const existing=await stripeRequest<StripeCoupon>(`/v1/coupons/${encodeURIComponent(input.id)}`);
  if(existing.response.ok)return assertCoupon(existing.payload,input.id,input.amountOffCents);
  if(existing.response.status!==404)throw new ApiError(existing.payload.error?.message??"Stripe could not verify the Founding Beta discount.",502,"BILLING_PROVIDER_FAILED");
  try{
    const created=await stripeForm<StripeCoupon>("/v1/coupons",new URLSearchParams({
      id:input.id,
      name:input.name,
      duration:"once",
      amount_off:String(input.amountOffCents),
      currency:"usd",
      "metadata[program]":"HD SEO Founding Beta 2026",
    }),`create-${input.id}`);
    return assertCoupon(created,input.id,input.amountOffCents);
  }catch(error){
    const raced=await stripeRequest<StripeCoupon>(`/v1/coupons/${encodeURIComponent(input.id)}`);
    if(raced.response.ok)return assertCoupon(raced.payload,input.id,input.amountOffCents);
    throw error;
  }
}
