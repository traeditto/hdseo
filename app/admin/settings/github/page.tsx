import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function GitHubSettingsAlias({searchParams}:{searchParams:Promise<{connected?:string}>}){
  const params=await searchParams,store=await cookies(),agencyId=store.get("hd_github_agency")?.value,target=new URL("/portal/admin/settings/github","https://hdseo.vercel.app");
  if(agencyId)target.searchParams.set("agencyId",agencyId);
  if(params.connected==="1")target.searchParams.set("github","connected");
  redirect(`${target.pathname}${target.search}`);
}
