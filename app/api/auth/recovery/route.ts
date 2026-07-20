import {createHash} from "node:crypto";
import {z} from "zod";
import {parseJson} from "@/lib/api/request";
import {ApiError,jsonError} from "@/lib/api/errors";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {enforceRateLimit} from "@/lib/automation/control-plane";
import {appBaseUrl} from "@/lib/config/env";

const schema=z.object({email:z.string().email().max(254),portal:z.enum(["admin","agency","client"]),action:z.enum(["password_reset","magic_link","resend_signup"])});
export async function POST(request:Request){try{
  const input=await parseJson(request,schema),email=input.email.trim().toLowerCase(),scope=createHash("sha256").update(email).digest("hex");await enforceRateLimit(`auth-link:${scope}`,input.action,3,3600);
  const db=await createSupabaseServerClient();if(!db)throw new ApiError("Production authentication is not configured.",503,"NOT_CONFIGURED");
  const destination=input.action==="password_reset"?`/reset-password?portal=${input.portal}`:`/portal/${input.portal}`,redirectTo=new URL(`/auth/callback?next=${encodeURIComponent(destination)}`,appBaseUrl()).toString();
  const result=input.action==="password_reset"?await db.auth.resetPasswordForEmail(email,{redirectTo}):input.action==="magic_link"?await db.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo,shouldCreateUser:false}}):await db.auth.resend({type:"signup",email,options:{emailRedirectTo:redirectTo}});
  if(result.error)throw new ApiError("The secure email could not be requested. Wait and try again.",400,"VALIDATION_ERROR");
  return Response.json({ok:true});
}catch(error){return jsonError(error)}}
