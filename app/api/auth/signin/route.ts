import {createHash} from "node:crypto";
import {z} from "zod";
import {parseJson} from "@/lib/api/request";
import {ApiError,jsonError} from "@/lib/api/errors";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {enforceRateLimit} from "@/lib/automation/control-plane";

const schema=z.object({email:z.string().email().max(254),password:z.string().min(1).max(1024)});
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function POST(request:Request){try{
  const input=await parseJson(request,schema),email=input.email.trim().toLowerCase(),ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown";
  await Promise.all([enforceRateLimit(`login:ip:${digest(ip)}`,"password",5,900),enforceRateLimit(`login:email:${digest(email)}`,"password",5,900)]);
  const db=await createSupabaseServerClient();if(!db)throw new ApiError("Production authentication is not configured.",503,"NOT_CONFIGURED");
  const signedIn=await db.auth.signInWithPassword({email,password:input.password});if(signedIn.error)throw new ApiError("Email or password is incorrect, or the email is not verified.",401,"AUTH_REQUIRED");
  return Response.json({ok:true});
}catch(error){return jsonError(error)}}
