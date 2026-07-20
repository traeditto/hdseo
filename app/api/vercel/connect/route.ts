import { z } from "zod";
import { env,appBaseUrl } from "@/lib/config/env";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { parseJson } from "@/lib/api/request";
import { jsonError, ApiError } from "@/lib/api/errors";
import { verifyIntegrationState } from "@/lib/security/signed-state";
import { encryptSecret } from "@/lib/security/encryption";
import { auditEvent, enterpriseClientId, requireAdminDb } from "@/lib/automation/control-plane";
import { addVercelProjectDomain, createVercelProject, exchangeVercelCode, getVercelProject, listVercelProjectDomains, vercelRequest, type VercelCredentials } from "@/lib/vercel/client";
import { loadVercelCredentials } from "@/lib/vercel/credentials";
import {consumeIntegrationState,issueIntegrationState} from "@/lib/security/integration-state-ledger";

const beginSchema=z.object({agencyId:z.string().uuid(),clientId:z.string().uuid().optional(),projectId:z.string().uuid().optional()});
const platformConnectionSchema=z.object({agencyId:z.string().uuid(),usePlatformToken:z.literal(true)});
const connectSchema=z.object({
  agencyId:z.string().uuid(),clientId:z.string().uuid(),projectId:z.string().uuid(),connectionId:z.string().uuid().optional(),
  accessToken:z.string().min(20).optional(),teamId:z.string().min(1).optional(),teamSlug:z.string().min(1).optional(),
  vercelProjectId:z.string().min(1).optional(),projectName:z.string().min(1).max(100),repositoryId:z.string().uuid(),
  framework:z.string().max(60).optional(),rootDirectory:z.string().max(500).optional(),productionDomains:z.array(z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i)).max(20).default([]),createIfMissing:z.boolean().default(true),
}).refine(value=>value.connectionId||value.accessToken,{message:"A Vercel connection or access token is required."});

async function storeConnection(input:{agencyId:string;userId:string;token:string;teamId?:string|null;teamSlug?:string|null;configurationId?:string|null}) {
  const credentials:VercelCredentials={token:input.token,teamId:input.teamId,teamSlug:input.teamSlug};
  const user=await vercelRequest<{user:{id:string;username?:string}}>("/v2/user",credentials);
  if(input.teamId) await vercelRequest(`/v2/teams/${encodeURIComponent(input.teamId)}`,credentials);
  const db=requireAdminDb(), saved=await db.from("vercel_connections").upsert({agency_id:input.agencyId,team_id:input.teamId??null,team_slug:input.teamSlug??null,configuration_id:input.configurationId??null,account_type:input.teamId?"team":"personal",encrypted_access_token:encryptSecret(input.token),status:"active",connected_by:input.userId,last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"agency_id,scope_key"}).select("id").single();
  if(!saved.data)throw new ApiError("Vercel connection could not be stored.",500,"OPERATION_FAILED");
  return {id:saved.data.id,userId:user.user.id};
}

export async function GET(request:Request){try{
  const url=new URL(request.url),code=url.searchParams.get("code"),stateValue=url.searchParams.get("state"),callbackTeamId=url.searchParams.get("teamId"),configurationId=url.searchParams.get("configurationId");
  if(code&&stateValue){
    if(!env.VERCEL_CLIENT_ID||!env.VERCEL_CLIENT_SECRET)throw new ApiError("Vercel OAuth is not configured.",503,"NOT_CONFIGURED");
    const state=verifyIntegrationState(stateValue,"vercel_connect"),context=await resolveTenantContext({agencyId:state.agencyId,clientId:state.clientId,projectId:state.projectId,requireProject:Boolean(state.projectId),requireAal2:true});requirePermission(context,"integrations.manage");
    if(context.user.id!==state.userId)throw new ApiError("The Vercel connection belongs to a different session.",403,"TENANT_DENIED");
    await consumeIntegrationState(requireAdminDb(),{rawState:stateValue,state,provider:"vercel",callbackHost:url.host});
    const token=await exchangeVercelCode(code,env.VERCEL_CLIENT_ID,env.VERCEL_CLIENT_SECRET),saved=await storeConnection({agencyId:context.agency.id,userId:context.user.id,token:token.access_token,teamId:token.team_id??callbackTeamId,configurationId});
    await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"vercel.connection.connected",resourceType:"vercel_connection",resourceId:saved.id,request});
    return Response.redirect(new URL(`/portal/agency?vercel=connected&connectionId=${saved.id}`,"https://hdseo.vercel.app"),303);
  }
  if(!env.VERCEL_INTEGRATION_SLUG)throw new ApiError("Vercel Integration slug is not configured.",503,"NOT_CONFIGURED");
  const parsed=beginSchema.safeParse(Object.fromEntries(url.searchParams));if(!parsed.success)throw new ApiError("A valid agency is required.",400,"VALIDATION_ERROR");
  const context=await resolveTenantContext({...parsed.data,requireProject:Boolean(parsed.data.projectId),requireAal2:true});requirePermission(context,"integrations.manage");
  const state=await issueIntegrationState(requireAdminDb(),{provider:"vercel",callbackHost:new URL("/api/vercel/connect",appBaseUrl()).host,state:{purpose:"vercel_connect",agencyId:context.agency.id,clientId:context.client?.id,projectId:context.project?.id,userId:context.user.id}});
  return Response.redirect(`https://vercel.com/integrations/${env.VERCEL_INTEGRATION_SLUG}/new?state=${encodeURIComponent(state)}`,307);
}catch(error){return jsonError(error)}}

export async function POST(request:Request){try{
  const input=await parseJson(request,z.union([platformConnectionSchema,connectSchema]));
  if("usePlatformToken" in input){
    const context=await resolveTenantContext({agencyId:input.agencyId,requireAal2:true});requirePermission(context,"agency.manage");requirePermission(context,"integrations.manage");
    if(!env.VERCEL_ACCESS_TOKEN)throw new ApiError("The platform Vercel token is not configured.",503,"NOT_CONFIGURED");
    const saved=await storeConnection({agencyId:context.agency.id,userId:context.user.id,token:env.VERCEL_ACCESS_TOKEN,teamId:env.VERCEL_TEAM_ID??null});
    await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"vercel.connection.platform_bound",resourceType:"vercel_connection",resourceId:saved.id,request,afterState:{teamId:env.VERCEL_TEAM_ID??null}});
    return Response.json({ok:true,connectionId:saved.id,status:"active"});
  }
  const context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:true,requireAal2:true});requirePermission(context,"integrations.manage");
  const db=requireAdminDb(),repositoryResult=await db.from("repositories").select("id,full_name,default_branch").eq("id",input.repositoryId).eq("agency_id",context.agency.id).eq("project_id",input.projectId).single();
  if(!repositoryResult.data)throw new ApiError("Connected GitHub repository not found.",404,"NOT_FOUND");
  let connectionId=input.connectionId,credentials:VercelCredentials;
  if(input.accessToken){const saved=await storeConnection({agencyId:context.agency.id,userId:context.user.id,token:input.accessToken,teamId:input.teamId,teamSlug:input.teamSlug});connectionId=saved.id;credentials={token:input.accessToken,teamId:input.teamId,teamSlug:input.teamSlug};}
  else credentials=await loadVercelCredentials(connectionId!,context.agency.id);
  let providerProject;
  if(input.vercelProjectId)providerProject=await getVercelProject(credentials,input.vercelProjectId);
  else if(input.createIfMissing){
    try{providerProject=await getVercelProject(credentials,input.projectName);}
    catch(error){
      if(!(error instanceof ApiError)||error.status!==404)throw error;
      try{providerProject=await createVercelProject(credentials,{name:input.projectName,repository:repositoryResult.data.full_name,framework:input.framework,rootDirectory:input.rootDirectory});}
      catch(createError){
        if(createError instanceof ApiError&&createError.code==="RATE_LIMITED")throw createError;
        throw new ApiError(`Vercel could not import ${repositoryResult.data.full_name}. Confirm the Vercel GitHub integration can access this repository.`,409,"CONFLICT",createError instanceof ApiError?createError.referenceId:undefined);
      }
    }
  }
  else throw new ApiError("A Vercel project ID is required.",400,"VALIDATION_ERROR");
  const linkedRepository=providerProject.link?.org&&providerProject.link?.repo?`${providerProject.link.org}/${providerProject.link.repo}`:null;
  if(providerProject.link?.type&&providerProject.link.type!=="github")throw new ApiError("The selected Vercel project is connected to a different Git provider.",409,"CONFLICT");
  if(linkedRepository&&linkedRepository.toLowerCase()!==repositoryResult.data.full_name.toLowerCase())throw new ApiError(`The selected Vercel project is connected to ${linkedRepository}, not ${repositoryResult.data.full_name}.`,409,"CONFLICT");
  const existingDomains=input.productionDomains.length?await listVercelProjectDomains(credentials,providerProject.id):{domains:[]},domainResults=await Promise.all(input.productionDomains.map(domain=>existingDomains.domains.find(item=>item.name===domain)??addVercelProjectDomain(credentials,providerProject.id,domain)));
  const currentMapping=await db.from("vercel_projects").select("id,project_id").eq("connection_id",connectionId!).eq("vercel_project_id",providerProject.id).maybeSingle();
  if(currentMapping.data&&currentMapping.data.project_id!==input.projectId)throw new ApiError("This Vercel project is already assigned to another client project. Choose a different Vercel project.",409,"CONFLICT");
  const clientId=await enterpriseClientId(input.clientId,context.agency.id),savedProject=await db.from("vercel_projects").upsert({agency_id:context.agency.id,client_id:clientId,project_id:input.projectId,connection_id:connectionId!,repository_id:input.repositoryId,vercel_project_id:providerProject.id,name:providerProject.name,framework:providerProject.framework??input.framework??null,root_directory:input.rootDirectory??null,production_branch:providerProject.link?.productionBranch??repositoryResult.data.default_branch,production_domains:input.productionDomains,environment_config:{domainVerification:domainResults},status:"active",last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"connection_id,vercel_project_id"}).select("id").single();
  if(!savedProject.data)throw new ApiError("Vercel project connection could not be stored.",500,"OPERATION_FAILED");
  await auditEvent({agencyId:context.agency.id,actorUserId:context.user.id,action:"vercel.project.connected",resourceType:"vercel_project",resourceId:savedProject.data.id,request,afterState:{vercelProjectId:providerProject.id,repositoryId:input.repositoryId}});
  return Response.json({ok:true,connectionId,vercelProject:{id:savedProject.data.id,providerId:providerProject.id,name:providerProject.name,domains:domainResults}});
}catch(error){return jsonError(error)}}
