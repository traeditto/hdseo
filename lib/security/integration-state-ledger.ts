import "server-only";

import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {ApiError} from "@/lib/api/errors";
import {encryptSecret} from "@/lib/security/encryption";
import {createIntegrationState,type IntegrationState} from "@/lib/security/signed-state";

type NewState=Omit<IntegrationState,"nonce"|"expiresAt"|"oauthStateId">;

export async function issueIntegrationState(db:SupabaseClient,input:{provider:string;callbackHost:string;state:NewState;ttlSeconds?:number}){
  const id=crypto.randomUUID(),nonce=crypto.randomUUID(),ttlSeconds=Math.max(60,Math.min(input.ttlSeconds??600,900));
  const signed=createIntegrationState({...input.state,oauthStateId:id,nonce},ttlSeconds);
  const saved=await db.from("integration_oauth_states").insert({
    id,agency_id:input.state.agencyId,user_id:input.state.userId,provider:input.provider,purpose:input.state.purpose,
    state_digest:createHash("sha256").update(signed).digest("hex"),callback_host:input.callbackHost,
    encrypted_access_token:encryptSecret(JSON.stringify({kind:"oauth_state",nonce})),
    context:{nonce,clientId:input.state.clientId??null,projectId:input.state.projectId??null,returnUrl:input.state.returnUrl??null,setupAction:input.state.setupAction??null},
    expires_at:new Date(Date.now()+ttlSeconds*1000).toISOString(),
  });
  if(saved.error)throw new ApiError("The integration security state could not be saved. Apply migration 0036.",500,"DATABASE_BINDING_FAILED");
  return signed;
}

export async function consumeIntegrationState(db:SupabaseClient,input:{rawState:string;state:IntegrationState;provider:string;callbackHost:string;ipHash?:string|null}){
  if(!input.state.oauthStateId)throw new ApiError("The integration security state is incomplete.",400,"INVALID_STATE");
  const consumed=await db.rpc("consume_integration_oauth_state_v2",{
    p_state_id:input.state.oauthStateId,p_provider:input.provider,p_purpose:input.state.purpose,
    p_agency_id:input.state.agencyId,p_user_id:input.state.userId,p_nonce:input.state.nonce,
    p_callback_host:input.callbackHost,p_state_digest:createHash("sha256").update(input.rawState).digest("hex"),p_ip_hash:input.ipHash??null,
  });
  if(consumed.error||!consumed.data?.[0])throw new ApiError("The integration security state expired, was changed, or was already used.",400,"INVALID_STATE");
  return consumed.data[0];
}
