import {jsonError} from "@/lib/api/errors";
import {requireLiveAgency} from "@/lib/auth/live-tenant";

export async function GET(){
  try{
    const context=await requireLiveAgency(),subscription=await context.db.from("agency_subscriptions").select("*").eq("agency_id",context.agencyId).maybeSingle();
    if(subscription.error)throw subscription.error;
    const enrollments=await context.db.from("agent_service_enrollments").select("id,plan_key,status").eq("agency_id",context.agencyId).eq("billing_owner","agency").in("status",["trialing","active"]);
    if(enrollments.error)throw enrollments.error;
    return Response.json({ok:true,billing:{subscription:subscription.data??null,usage:{activeClients:enrollments.data?.length??0,scaleClients:enrollments.data?.filter(row=>row.plan_key==="agency_scale").length??0}}});
  }catch(error){return jsonError(error);}
}
