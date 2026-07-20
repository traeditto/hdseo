import "server-only";

import {ApiError} from "@/lib/api/errors";
import {env} from "@/lib/config/env";

export async function verifyTurnstile(token:string|undefined,request:Request){
  if(!env.TURNSTILE_SECRET_KEY){
    if(process.env.VERCEL_ENV==="production")throw new ApiError("Account protection is not configured.",503,"NOT_CONFIGURED");
    return;
  }
  if(!token)throw new ApiError("Complete the account security check.",400,"VALIDATION_ERROR");
  const body=new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token});
  const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();if(ip)body.set("remoteip",ip);
  const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)}),result=await response.json() as {success?:boolean};
  if(!response.ok||!result.success)throw new ApiError("The account security check failed. Refresh and try again.",400,"VALIDATION_ERROR");
}
