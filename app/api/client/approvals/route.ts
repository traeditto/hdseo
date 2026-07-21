import {z} from "zod";

import {ApiError,jsonError} from "@/lib/api/errors";
import {parseJson} from "@/lib/api/request";
import {requireClientApproval,resolveClientContext} from "@/lib/auth/context";
import {implementationPackageDigest,implementationPackageSnapshot} from "@/lib/safety/package-approval";
import {createSupabaseAdminClient} from "@/lib/supabase/admin";
import {wakeManagedAgentService} from "@/lib/agent-service/wake";

const schema=z.object({clientId:z.string().uuid(),projectId:z.string().uuid(),packageId:z.string().uuid(),decision:z.enum(["approved","rejected","revision_requested"]),note:z.string().max(4000).optional()});

export async function GET(request:Request){try{
  const url=new URL(request.url),context=await resolveClientContext({clientId:url.searchParams.get("clientId")??undefined,projectId:url.searchParams.get("projectId")??undefined,requireProject:true}),db=createSupabaseAdminClient();
  if(!db||!context.project)throw new ApiError("Supabase is not configured.",503,"NOT_CONFIGURED");
  const publications=await db.from("client_portal_publications").select("id,record_type,source_id,title,summary,status,payload,published_at").eq("agency_id",context.agency.id).eq("client_organization_id",context.client.id).eq("project_id",context.project.id).is("revoked_at",null).order("published_at",{ascending:false});
  if(publications.error)throw new ApiError("Client approvals could not be loaded.",500,"OPERATION_FAILED");
  return Response.json({ok:true,approvals:publications.data});
}catch(error){return jsonError(error)}}

export async function POST(request:Request){try{
  const input=await parseJson(request,schema),context=await resolveClientContext({clientId:input.clientId,projectId:input.projectId,requireProject:true});requireClientApproval(context);
  const db=createSupabaseAdminClient();if(!db||!context.project)throw new ApiError("Supabase is not configured.",503,"NOT_CONFIGURED");
  const pkg=await db.from("implementation_packages").select("*").eq("id",input.packageId).eq("agency_id",context.agency.id).eq("client_organization_id",context.client.id).eq("project_id",context.project.id).maybeSingle();
  if(!pkg.data)throw new ApiError("Implementation package not found.",404,"NOT_FOUND");
  const approved=input.decision==="approved",decision=approved?"client_approved":input.decision,approvalDigest=approved?implementationPackageDigest(pkg.data):null,approvedSnapshot=approved?implementationPackageSnapshot(pkg.data):{};
  const result=await db.rpc("decide_implementation_package",{p_agency_id:context.agency.id,p_client_organization_id:context.client.id,p_project_id:context.project.id,p_package_id:input.packageId,p_user_id:context.user.id,p_decision:decision,p_note:input.note??null,p_approval_digest:approvalDigest,p_approved_snapshot:approvedSnapshot});
  if(result.error)throw new ApiError("The exact client decision could not be committed. It may already have been decided.",409,"CONFLICT");
  await wakeManagedAgentService(db,{agencyId:context.agency.id,clientId:context.client.id,projectId:context.project.id,reason:"approval_decided"});
  return Response.json({ok:true,decision:input.decision,approvalDigest});
}catch(error){return jsonError(error)}}
