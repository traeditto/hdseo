import "server-only";
import { requireAdminDb } from "@/lib/automation/control-plane";
import { ApiError,logServerError } from "@/lib/api/errors";
import { discoverSuiteResources,syncAnalytics,syncBusinessProfile } from "@/lib/google/suite";
import { nextProviderSyncAt,providerResourceNeedsDiscovery } from "@/lib/outcomes/provider-health";
import { syncAttributionConnection } from "@/lib/providers/attribution";

type OutcomeProvider="google_analytics"|"google_business_profile"|"callrail"|"hubspot";
type ConnectionRow={id:string;agency_id:string;client_organization_id:string;project_id:string;provider:OutcomeProvider;selected_resource:string|null;last_synced_at:string|null;consecutive_sync_failures:number|null;metadata:Record<string,unknown>|null};

export async function syncOutcomeProviders(limit=10){
  const db=requireAdminDb(),now=new Date(),cutoff=new Date(now.getTime()-6*60*60*1000).toISOString(),connections=await db.from("integration_connections").select("id,agency_id,client_organization_id,project_id,provider,selected_resource,last_synced_at,consecutive_sync_failures,metadata").in("provider",["google_analytics","google_business_profile","callrail","hubspot"]).eq("status","active").or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`).or(`next_sync_at.is.null,next_sync_at.lte.${now.toISOString()}`).order("next_sync_at",{ascending:true,nullsFirst:true}).limit(limit);
  if(connections.error){logServerError("outcome_provider_query_failed",connections.error,{operation:"scheduled_sync"});return{claimed:0,succeeded:0,deferred:0,failed:1,results:[],error:"OUTCOME_CONNECTION_QUERY_FAILED"};}
  const results:Array<Record<string,unknown>>=[];
  for(const raw of connections.data??[]){
    const row=raw as ConnectionRow,tenant={agencyId:row.agency_id,clientId:row.client_organization_id,projectId:row.project_id,userId:null},needsDiscovery=providerResourceNeedsDiscovery(row);
    try{
      if(needsDiscovery){
        const discovery=await discoverSuiteResources(db,tenant,row.provider as "google_analytics"|"google_business_profile");
        if(!discovery.selected){
          const attemptedAt=new Date();
          await db.from("integration_connections").update({last_sync_attempt_at:attemptedAt.toISOString(),next_sync_at:new Date(attemptedAt.getTime()+24*60*60*1000).toISOString(),consecutive_sync_failures:0,last_sync_error_code:null,last_sync_error_message:null,updated_at:attemptedAt.toISOString()}).eq("id",row.id);
          results.push({connectionId:row.id,provider:row.provider,status:"selection_required",resources:discovery.resources});
          continue;
        }
      }
      const result=row.provider==="google_analytics"?await syncAnalytics(db,tenant):row.provider==="google_business_profile"?await syncBusinessProfile(db,tenant):await syncAttributionConnection(db,tenant,row.provider as "callrail"|"hubspot"),completedAt=new Date();
      await db.from("integration_connections").update({last_sync_attempt_at:completedAt.toISOString(),next_sync_at:nextProviderSyncAt(completedAt),consecutive_sync_failures:0,last_sync_error_code:null,last_sync_error_message:null,updated_at:completedAt.toISOString()}).eq("id",row.id);
      results.push({connectionId:row.id,provider:row.provider,status:"succeeded",result});
    }catch(error){
      const attemptedAt=new Date(),consecutiveFailures=(row.consecutive_sync_failures??0)+1,errorCode=error instanceof ApiError?error.code:"PROVIDER_SYNC_FAILED",update:Record<string,unknown>={last_sync_attempt_at:attemptedAt.toISOString(),next_sync_at:nextProviderSyncAt(attemptedAt,consecutiveFailures),consecutive_sync_failures:consecutiveFailures,last_sync_error_code:errorCode,last_sync_error_message:"Provider synchronization failed.",updated_at:attemptedAt.toISOString()};
      if(!needsDiscovery)update.metadata={...(row.metadata??{}),health:"sync_failed",lastFailureAt:attemptedAt.toISOString(),lastSyncAttemptAt:attemptedAt.toISOString()};
      await db.from("integration_connections").update(update).eq("id",row.id);
      logServerError("outcome_provider_sync_failed",error,{agencyId:row.agency_id,projectId:row.project_id,provider:row.provider,operation:"scheduled_sync",errorCode});
      results.push({connectionId:row.id,provider:row.provider,status:"failed",errorCode});
    }
  }
  return{claimed:(connections.data??[]).length,succeeded:results.filter(item=>item.status==="succeeded").length,deferred:results.filter(item=>item.status==="selection_required").length,failed:results.filter(item=>item.status==="failed").length,results};
}
