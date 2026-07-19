import "server-only";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api/errors";
import { getLiveAdminClient,resolveLiveIdentity } from "@/lib/live/identity";
import { hasPermission,type AgencyRole } from "@/lib/auth/permissions";

export async function requireLiveAgencyProject(input:{projectId:string;permission?:string}){
  let user=await getChatGPTUser();
  if(!user){
    const session=await createSupabaseServerClient(),account=session?(await session.auth.getUser()).data.user:null;
    if(account?.email){const displayName=String(account.user_metadata?.full_name||account.user_metadata?.name||account.email.split("@")[0]);user={displayName,email:account.email,fullName:displayName};}
  }
  if(!user)throw new ApiError("Sign in to HD SEO to continue.",401,"AUTH_REQUIRED");
  const db=getLiveAdminClient(),identity=await resolveLiveIdentity(db,user);
  const membership=await db.from("agency_members").select("agency_id,role").eq("user_id",identity.userId).eq("status","active").limit(1).maybeSingle();
  if(membership.data){
    const role=membership.data.role as AgencyRole;
    const project=await db.from("seo_projects").select("id,name,domain,canonical_domain,client_organization_id").eq("id",input.projectId).eq("agency_id",membership.data.agency_id).eq("status","active").maybeSingle();
    if(project.data){
      if(input.permission&&!hasPermission(role,input.permission))throw new ApiError("Your agency role cannot manage this integration.",403,"ROLE_FORBIDDEN");
      return{db,userId:identity.userId,email:identity.email,agencyId:membership.data.agency_id as string,clientId:project.data.client_organization_id as string,project:project.data,role,actorType:"agency" as const};
    }
  }
  const targetProject=await db.from("seo_projects").select("id,name,domain,canonical_domain,agency_id,client_organization_id").eq("id",input.projectId).eq("status","active").maybeSingle();
  if(!targetProject.data)throw new ApiError("Business project not found.",404,"NOT_FOUND");
  const clientMembership=await db.from("client_members").select("agency_id,client_organization_id,role").eq("user_id",identity.userId).eq("agency_id",targetProject.data.agency_id).eq("client_organization_id",targetProject.data.client_organization_id).eq("status","active").maybeSingle();
  if(!clientMembership.data)throw new ApiError("Business access denied.",403,"TENANT_DENIED");
  const clientRole=clientMembership.data.role as "client_admin"|"client_approver"|"client_viewer";
  const clientCanManage=input.permission==="provider.authorize"
    ? ["client_admin","client_approver"].includes(clientRole)
    : clientRole==="client_admin";
  if(input.permission&&!clientCanManage)throw new ApiError("Only the business owner can manage this connection.",403,"ROLE_FORBIDDEN");
  return{db,userId:identity.userId,email:identity.email,agencyId:clientMembership.data.agency_id as string,clientId:targetProject.data.client_organization_id as string,project:targetProject.data,role:clientRole,actorType:"client" as const};
}

export async function requireLiveAgency(input:{permission?:string}={}){
  let user=await getChatGPTUser();
  if(!user){
    const session=await createSupabaseServerClient(),account=session?(await session.auth.getUser()).data.user:null;
    if(account?.email){const displayName=String(account.user_metadata?.full_name||account.user_metadata?.name||account.email.split("@")[0]);user={displayName,email:account.email,fullName:displayName};}
  }
  if(!user)throw new ApiError("Sign in to HD SEO to continue.",401,"AUTH_REQUIRED");
  const db=getLiveAdminClient(),identity=await resolveLiveIdentity(db,user);
  const membership=await db.from("agency_members").select("agency_id,role").eq("user_id",identity.userId).eq("status","active").limit(1).maybeSingle();
  if(!membership.data)throw new ApiError("Agency access denied.",403,"TENANT_DENIED");
  const role=membership.data.role as AgencyRole;
  if(input.permission&&!hasPermission(role,input.permission))throw new ApiError("Your agency role cannot manage billing.",403,"ROLE_FORBIDDEN");
  return{db,userId:identity.userId,email:identity.email,agencyId:membership.data.agency_id as string,role,actorType:"agency" as const};
}
