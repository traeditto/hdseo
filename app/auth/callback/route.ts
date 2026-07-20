import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appBaseUrl } from "@/lib/config/env";

type SupportedEmailOtpType="signup"|"invite"|"magiclink"|"recovery"|"email_change"|"email";

const supportedEmailOtpTypes=new Set<SupportedEmailOtpType>(["signup","invite","magiclink","recovery","email_change","email"]);

function safeNext(value:string|null){
  return value?.startsWith("/")&&!value.startsWith("//")?value:"/";
}

function emailOtpType(value:string|null):SupportedEmailOtpType|null{
  return value&&supportedEmailOtpTypes.has(value as SupportedEmailOtpType)?value as SupportedEmailOtpType:null;
}

function loginFor(next:string){
  if(next.startsWith("/portal/client"))return "/login/client";
  if(next.startsWith("/portal/agency"))return "/login/agency";
  return "/login/admin";
}

export async function GET(request:Request){
  const url=new URL(request.url),code=url.searchParams.get("code"),tokenHash=url.searchParams.get("token_hash"),type=emailOtpType(url.searchParams.get("type")),next=safeNext(url.searchParams.get("next")),origin=process.env.VERCEL?appBaseUrl():url.origin;
  const db=await createSupabaseServerClient();
  if(!db)return Response.redirect(new URL(`${loginFor(next)}?error=auth_not_configured`,origin),303);
  if(code){const result=await db.auth.exchangeCodeForSession(code);if(!result.error)return Response.redirect(new URL(next,origin),303);}
  if(tokenHash&&type){const result=await db.auth.verifyOtp({token_hash:tokenHash,type});if(!result.error)return Response.redirect(new URL(next,origin),303);}
  return Response.redirect(new URL(`${loginFor(next)}?error=invalid_or_expired_link`,origin),303);
}
