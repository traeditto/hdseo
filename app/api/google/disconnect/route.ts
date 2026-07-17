import { z } from "zod";
import { parseJson } from "@/lib/api/request";
import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";

const schema=z.object({projectId:z.string().uuid(),confirm:z.literal(true)});
export async function POST(request:Request){try{const input=await parseJson(request,schema),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"integrations.manage"}),now=new Date().toISOString(),result=await context.db.from("integration_connections").update({status:"disconnected",encrypted_secret_reference:null,selected_resource:null,metadata:{health:"disconnected"},updated_at:now}).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",input.projectId).eq("provider","google_search_console");if(result.error)throw new ApiError("Search Console could not be disconnected.",500,"DATABASE_BINDING_FAILED");await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"google.search_console.disconnected",resourceType:"seo_project",resourceId:input.projectId,request});return Response.json({ok:true});}catch(error){return jsonError(error);}}
