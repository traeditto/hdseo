import {createHash} from "node:crypto";
import {z} from "zod";
import {parseJson} from "@/lib/api/request";
import {ApiError,jsonError} from "@/lib/api/errors";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {enforceRateLimit} from "@/lib/automation/control-plane";
import {verifyTurnstile} from "@/lib/auth/turnstile";
import {appBaseUrl} from "@/lib/config/env";

const schema=z.object({email:z.string().email().max(254),password:z.string().min(10).max(128),fullName:z.string().trim().min(2).max(120),portal:z.enum(["agency","client"]),turnstileToken:z.string().max(4096).optional()});
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function POST(request:Request){try{
  const input=await parseJson(request,schema),email=input.email.trim().toLowerCase(),ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown";
  await Promise.all([enforceRateLimit(`signup:ip:${digest(ip)}`,"account",3,86400),enforceRateLimit(`signup:email:${digest(email)}`,"account",3,86400)]);await verifyTurnstile(input.turnstileToken,request);
  const db=await createSupabaseServerClient();if(!db)throw new ApiError("Production authentication is not configured.",503,"NOT_CONFIGURED");
  const destination=input.portal==="client"?"/portal/client?welcome=1":"/portal/agency",result=await db.auth.signUp({email,password:input.password,options:{data:{full_name:input.fullName,account_type:input.portal,signup_source:input.portal==="client"?"self_service_free_trial":"self_service"},emailRedirectTo:new URL(`/auth/callback?next=${encodeURIComponent(destination)}`,appBaseUrl()).toString(),captchaToken:input.turnstileToken}});
  if(result.error)throw new ApiError("The account could not be created. Check the information and try again.",400,"VALIDATION_ERROR");
  return Response.json({ok:true,session:Boolean(result.data.session),verificationRequired:!result.data.session,destination});
}catch(error){return jsonError(error)}}
