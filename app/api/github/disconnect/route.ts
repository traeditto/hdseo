import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { auditEvent } from "@/lib/automation/control-plane";
import { deleteInstallation } from "@/lib/github/app-client";
import { resolveGitHubManagementContext } from "@/lib/github/integration-context";
import { findAgencyInstallationRecord } from "@/lib/github/tenant-installation";

const schema=z.object({agencyId:z.string().uuid(),confirm:z.literal(true)});

export async function POST(request:Request){try{
  const input=await parseJson(request,schema),context=await resolveGitHubManagementContext(input),record=await findAgencyInstallationRecord(context.db,context.agency.id);
  if(!record||record.status!=="active")throw new ApiError("Active GitHub installation not found.",404,"NOT_FOUND");
  const now=new Date().toISOString();
  await Promise.all([
    context.db.from("repositories").update({status:"disabled",updated_at:now}).eq("agency_id",context.agency.id).eq("github_installation_id",record.id),
    context.db.from("repository_connections").update({status:"connection_required",updated_at:now}).eq("agency_id",context.agency.id).eq("installation_id",record.installationId),
  ]);
  const remaining=await context.db.from("repositories").select("id",{head:true,count:"exact"}).eq("github_installation_id",record.id).eq("status","active");
  const removeInstallation=(remaining.count??0)===0;
  if(removeInstallation){await deleteInstallation(record.installationId);await context.db.from("github_installations").update({status:"deleted",updated_at:now}).eq("id",record.id);}
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"github.installation.disconnected",resourceType:"github_installation",resourceId:String(record.installationId),request,afterState:{providerInstallationRemoved:removeInstallation}});
  return Response.json({ok:true,disconnectedAt:now,providerInstallationRemoved:removeInstallation});
}catch(error){return jsonError(error)}}
