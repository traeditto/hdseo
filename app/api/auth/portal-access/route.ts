import { z } from "zod";

import { isPortalRole } from "@/lib/auth/portal-types";
import { resolvePortalAccess } from "@/lib/auth/portal-access";
import { jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";

const schema = z.object({ portal: z.enum(["admin", "agency", "client"]) });

export async function POST(request:Request){
  try{const body=await parseJson(request,schema);if(!isPortalRole(body.portal))return Response.json({ok:false,error:{message:"Choose a valid HD SEO portal."}},{status:400});const access=await resolvePortalAccess(body.portal);if(!access)return Response.json({ok:false,error:{message:`This account is not authorized for the ${body.portal} portal.`}},{status:403});return Response.json({ok:true,destination:access.destination,role:access.role,organization:access.organization});}catch(error){return jsonError(error);}
}
