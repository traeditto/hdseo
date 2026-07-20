import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { googleSuiteCallbackUrl } from "@/lib/config/env";
import { GOOGLE_ANALYTICS_SCOPES,GOOGLE_BUSINESS_SCOPES } from "@/lib/google/suite";
import { googleAuthorizationUrl } from "@/lib/google/search-console";
import {issueIntegrationState} from "@/lib/security/integration-state-ledger";

export async function GET(request:Request){try{const url=new URL(request.url),projectId=url.searchParams.get("projectId"),provider=url.searchParams.get("provider");if(!projectId||!(["google_analytics","google_business_profile"] as const).includes(provider as never))throw new ApiError("Choose a client project and Google integration.",400,"VALIDATION_ERROR");const context=await requireLiveAgencyProject({projectId,permission:"integrations.manage"}),purpose=provider as "google_analytics"|"google_business_profile",requested=url.searchParams.get("returnUrl"),returnUrl=requested?.startsWith("/")&&!requested.startsWith("//")?requested:"/portal/agency?tab=Results",state=await issueIntegrationState(context.db,{provider:purpose,callbackHost:new URL(googleSuiteCallbackUrl()).host,state:{purpose,agencyId:context.agencyId,clientId:context.clientId,projectId,userId:context.userId,returnUrl}});await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`${purpose}.connect_started`,resourceType:"seo_project",resourceId:projectId,request});return Response.redirect(googleAuthorizationUrl(state,{scopes:purpose==="google_analytics"?GOOGLE_ANALYTICS_SCOPES:GOOGLE_BUSINESS_SCOPES,redirectUri:googleSuiteCallbackUrl()}),303);}catch(error){return jsonError(error)}}
