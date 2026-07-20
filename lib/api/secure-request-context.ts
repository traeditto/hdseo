import "server-only";

import {ApiError} from "@/lib/api/errors";
import {resolveTenantContext,requirePermission,type TenantContext} from "@/lib/auth/context";
import {permissionMatrix,type AgencyRole} from "@/lib/auth/permissions";

export type SecureRequestContext={
  requestId:string;
  traceId:string;
  traceparent:string|null;
  canonicalOrigin:string;
  authenticatedUser:TenantContext["user"];
  aal:"aal1"|"aal2";
  tenant:{agencyId:string;clientId:string|null;projectId:string|null};
  role:AgencyRole;
  permissions:readonly string[];
  tenantContext:TenantContext;
};

const tracePattern=/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/i;

export async function requireSecureRequestContext(request:Request,input:{
  permission:string;agencyId?:string;clientId?:string;projectId?:string;
  requireProject?:boolean;requireAal2?:boolean;
}):Promise<SecureRequestContext>{
  const context=await resolveTenantContext({agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,requireProject:input.requireProject,requireAal2:input.requireAal2});
  requirePermission(context,input.permission);
  const requestId=(request.headers.get("x-request-id")||crypto.randomUUID()).slice(0,100),traceparent=request.headers.get("traceparent"),validTrace=traceparent&&tracePattern.test(traceparent)?traceparent:null;
  if(traceparent&&!validTrace)throw new ApiError("The trace context is invalid.",400,"VALIDATION_ERROR");
  return{
    requestId,traceId:validTrace?.split("-")[1]??requestId,traceparent:validTrace,
    canonicalOrigin:"https://hdseo.vercel.app",authenticatedUser:context.user,
    aal:input.requireAal2?"aal2":"aal1",tenant:{agencyId:context.agency.id,clientId:context.client?.id??null,projectId:context.project?.id??null},
    role:context.role,permissions:permissionMatrix[context.role],tenantContext:context,
  };
}
