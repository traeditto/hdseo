import { redirect } from "next/navigation";
import { MfaSetup } from "@/app/ui/mfa-setup";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/auth/mfa";

export const dynamic="force-dynamic";
export default async function MfaPage({searchParams}:{searchParams:Promise<{returnTo?:string}>}){
  const db=await createSupabaseServerClient(),user=db?(await db.auth.getUser()).data.user:null;
  if(!user)redirect("/login");
  const returnTo=safeReturnPath((await searchParams).returnTo);
  const assurance=await db!.auth.mfa.getAuthenticatorAssuranceLevel();
  if(assurance.data?.currentLevel==="aal2")redirect(returnTo);
  return <MfaSetup returnTo={returnTo}/>;
}
