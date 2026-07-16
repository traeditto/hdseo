import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNext(value:string|null){
  return value?.startsWith("/")&&!value.startsWith("//")?value:"/";
}

export async function GET(request:Request){
  const url=new URL(request.url),code=url.searchParams.get("code"),next=safeNext(url.searchParams.get("next"));
  const db=await createSupabaseServerClient();
  if(!db)return Response.redirect(new URL("/login/admin?error=auth_not_configured",url.origin),303);
  if(code){const result=await db.auth.exchangeCodeForSession(code);if(!result.error)return Response.redirect(new URL(next,url.origin),303);}
  return Response.redirect(new URL(`/login/admin?error=invalid_link`,url.origin),303);
}
