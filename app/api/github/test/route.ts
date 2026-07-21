import { z } from "zod";

import { ApiError, jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { auditEvent } from "@/lib/automation/control-plane";
import { getInstallation, listInstallationRepositories } from "@/lib/github/app-client";
import { resolveGitHubManagementContext } from "@/lib/github/integration-context";
import { findAgencyInstallationRecord } from "@/lib/github/tenant-installation";

const schema=z.object({agencyId:z.string().uuid()});

export async function POST(request:Request){try{
  const input=await parseJson(request,schema),context=await resolveGitHubManagementContext(input),record=await findAgencyInstallationRecord(context.db,context.agency.id);
  if(!record||record.status!=="active")throw new ApiError("Active GitHub installation not found.",404,"NOT_FOUND");
  const[installation,repositories]=await Promise.all([getInstallation(record.installationId),listInstallationRepositories(record.installationId)]),now=new Date().toISOString();
  await context.db.from("github_installations").update({account_login:installation.account.login,repository_selection:installation.repository_selection,permissions:installation.permissions,events:installation.events,last_synced_at:now,updated_at:now}).eq("id",record.id);
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"github.connection.tested",resourceType:"github_installation",resourceId:String(installation.id),request,afterState:{repositoryCount:repositories.length}});
  return Response.json({ok:true,installationId:installation.id,account:installation.account.login,repositoryCount:repositories.length,testedAt:now});
}catch(error){return jsonError(error)}}
