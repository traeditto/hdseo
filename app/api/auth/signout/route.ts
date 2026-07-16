import { getChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request:Request){
  const origin=new URL(request.url).origin;
  if(await getChatGPTUser())return Response.redirect(new URL(chatGPTSignOutPath("/"),origin),303);
  const db=await createSupabaseServerClient();
  if(db)await db.auth.signOut();
  return Response.redirect(new URL("/",origin),303);
}
