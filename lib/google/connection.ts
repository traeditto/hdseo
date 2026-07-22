import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { decryptSecret,encryptSecret } from "@/lib/security/encryption";
import { refreshGoogleCredentials,type GoogleCredentials } from "./search-console";

export type GoogleConnection={id:string;agency_id:string;client_organization_id:string;project_id:string;selected_resource:string|null;encrypted_secret_reference:string|null;status:string;last_synced_at:string|null;last_sync_attempt_at?:string|null;next_sync_at?:string|null;consecutive_sync_failures?:number;last_sync_error_code?:string|null;metadata:Record<string,unknown>};

export async function loadGoogleConnection(db:SupabaseClient,input:{connectionId?:string;agencyId:string;clientId:string;projectId:string}){
  let query=db.from("integration_connections").select("id,agency_id,client_organization_id,project_id,selected_resource,encrypted_secret_reference,status,last_synced_at,metadata").eq("provider","google_search_console").eq("agency_id",input.agencyId).eq("client_organization_id",input.clientId).eq("project_id",input.projectId);
  if(input.connectionId)query=query.eq("id",input.connectionId);
  const result=await query.maybeSingle();
  if(!result.data||result.data.status!=="active"||!result.data.encrypted_secret_reference)throw new ApiError("Connect Google Search Console before syncing evidence.",409,"SEARCH_CONSOLE_NOT_CONNECTED");
  return result.data as GoogleConnection;
}

export async function googleAccess(db:SupabaseClient,connection:GoogleConnection){
  let stored:GoogleCredentials;
  try{stored=JSON.parse(decryptSecret(connection.encrypted_secret_reference!)) as GoogleCredentials;}
  catch{throw new ApiError("Reconnect Search Console because its stored authorization is invalid.",409,"SEARCH_CONSOLE_NOT_CONNECTED");}
  const current=await refreshGoogleCredentials(stored);
  if(current.accessToken!==stored.accessToken||current.expiresAt!==stored.expiresAt){
    const updated=await db.from("integration_connections").update({encrypted_secret_reference:encryptSecret(JSON.stringify(current)),last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",connection.id).eq("agency_id",connection.agency_id);
    if(updated.error)throw new ApiError("The renewed Search Console authorization could not be stored.",500,"DATABASE_BINDING_FAILED");
  }
  return current.accessToken;
}

export function publicGoogleConnection(row:Record<string,unknown>){
  return{id:String(row.id),projectId:String(row.project_id),status:String(row.status),selectedProperty:typeof row.selected_resource==="string"?row.selected_resource:null,lastSyncedAt:typeof row.last_synced_at==="string"?row.last_synced_at:null,lastVerifiedAt:typeof row.last_verified_at==="string"?row.last_verified_at:null,properties:Array.isArray((row.metadata as Record<string,unknown>|null)?.properties)?(row.metadata as Record<string,unknown>).properties:[],health:typeof (row.metadata as Record<string,unknown>|null)?.health==="string"?(row.metadata as Record<string,unknown>).health:"unknown"};
}
