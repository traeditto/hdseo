import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { auditEvent } from "@/lib/automation/control-plane";
import { deleteInstallation } from "@/lib/github/app-client";
import { resolveGitHubManagementContext } from "@/lib/github/integration-context";

const schema=z.object({agencyId:z.string().uuid(),confirm:z.literal(true)});

export async function POST(request:Request){try{
  const input=await parseJson(request,schema),context=await resolveGitHubManagementContext(input),record=await context.db.from("github_installations").select("id,installation_id").eq("agency_id",context.agency.id).eq("status","active").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(!record.data)throw new ApiError("Active GitHub installation not found.",404,"NOT_FOUND");
  await deleteInstallation(Number(record.data.installation_id));
  const now=new Date().toISOString();
  await Promise.all([
    context.db.from("github_installations").update({status:"deleted",updated_at:now}).eq("id",record.data.id),
    context.db.from("repositories").update({status:"disabled",updated_at:now}).eq("agency_id",context.agency.id).eq("github_installation_id",record.data.id),
    context.db.from("repository_connections").update({status:"connection_required",updated_at:now}).eq("agency_id",context.agency.id).eq("installation_id",Number(record.data.installation_id)),
  ]);
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"github.installation.disconnected",resourceType:"github_installation",resourceId:String(record.data.installation_id),request});
  return Response.json({ok:true,disconnectedAt:now});
}catch(error){return jsonError(error)}}
