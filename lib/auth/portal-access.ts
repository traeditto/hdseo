import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PortalIdentity,PortalRole } from "./portal-types";

export async function resolvePortalAccess(portal:PortalRole):Promise<PortalIdentity|null>{
  const db=await createSupabaseServerClient();if(!db)return null;
  const {data:{user}}=await db.auth.getUser();if(!user?.email)return null;
  const displayName=String(user.user_metadata?.full_name||user.user_metadata?.name||user.email.split("@")[0]);
  if(portal==="admin"){
    const result=await db.from("platform_admins").select("role,status").eq("user_id",user.id).eq("status","active").maybeSingle();
    return result.data?{userId:user.id,email:user.email,displayName,organization:"HD SEO Platform",role:result.data.role,destination:"/portal/admin"}:null;
  }
  if(portal==="agency"){
    const result=await db.from("agency_members").select("role,agencies(name)").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle(),agency=Array.isArray(result.data?.agencies)?result.data?.agencies[0]:result.data?.agencies;
    if(result.data&&agency)return {userId:user.id,email:user.email,displayName,organization:agency.name,role:result.data.role,destination:"/portal/agency"};
    // A verified account without a membership must still be able to reach the
    // first-run workspace creator. All tenant data remains unavailable until
    // create_agency attaches the user as the agency owner.
    return {userId:user.id,email:user.email,displayName,organization:"New agency workspace",role:"onboarding",destination:"/portal/agency"};
  }
  const result=await db.from("client_members").select("role,client_organizations(name)").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle(),client=Array.isArray(result.data?.client_organizations)?result.data?.client_organizations[0]:result.data?.client_organizations;
  if(result.data&&client)return {userId:user.id,email:user.email,displayName,organization:client.name,role:result.data.role,destination:"/portal/client"};
  // A verified owner can enter the retail onboarding shell before a tenant is
  // created. The only available mutation is the atomic, service-role retail
  // workspace creator; no existing client data is exposed.
  return {userId:user.id,email:user.email,displayName,organization:"New business workspace",role:"onboarding",destination:"/portal/client"};
}
