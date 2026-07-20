import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

import {ApiError} from "@/lib/api/errors";

export async function claimWebhookEvent(db:SupabaseClient,input:{provider:string;deliveryId:string;agencyId?:string|null;eventType:string;action?:string|null;payloadHash:string;payload:unknown}){
  const claimTime=new Date().toISOString(),inserted=await db.from("webhook_events").insert({provider:input.provider,delivery_id:input.deliveryId,agency_id:input.agencyId??null,event_type:input.eventType,action:input.action??null,payload_hash:input.payloadHash,payload:input.payload,signature_valid:true,status:"processing",attempt_count:1,processing_started_at:claimTime}).select("id,status,attempt_count").single();
  if(!inserted.error&&inserted.data)return{eventId:inserted.data.id,duplicate:false,replayed:false};
  if(inserted.error?.code!=="23505")throw new ApiError("The verified webhook could not be stored.",500,"DATABASE_BINDING_FAILED");
  const existing=await db.from("webhook_events").select("id,status,attempt_count,payload_hash,received_at,processing_started_at").eq("provider",input.provider).eq("delivery_id",input.deliveryId).maybeSingle();
  if(!existing.data)throw new ApiError("The duplicate webhook could not be reconciled.",500,"DATABASE_BINDING_FAILED");
  if(existing.data.payload_hash!==input.payloadHash)throw new ApiError("A webhook delivery identifier was reused with a different signed payload.",409,"WEBHOOK_REPLAY_REJECTED");
  if(["processed","ignored"].includes(existing.data.status))return{eventId:existing.data.id,duplicate:true,replayed:false};
  const stale=existing.data.status==="processing"&&Date.now()-new Date(existing.data.processing_started_at??existing.data.received_at).getTime()>5*60_000;
  if(existing.data.status==="processing"&&!stale)return{eventId:existing.data.id,duplicate:true,replayed:false};
  const claimed=await db.from("webhook_events").update({status:"processing",attempt_count:Number(existing.data.attempt_count??0)+1,error_code:null,error_message:null,processed_at:null,processing_started_at:claimTime}).eq("id",existing.data.id).eq("attempt_count",Number(existing.data.attempt_count??0)).in("status",stale?["processing","failed"]:["failed"]).select("id").maybeSingle();
  if(!claimed.data)return{eventId:existing.data.id,duplicate:true,replayed:false};
  return{eventId:existing.data.id,duplicate:false,replayed:true};
}

export async function completeWebhookEvent(db:SupabaseClient,input:{eventId:string;status:"processed"|"ignored"}){
  const result=await db.from("webhook_events").update({status:input.status,processed_at:new Date().toISOString(),error_code:null,error_message:null}).eq("id",input.eventId).eq("status","processing").select("id").maybeSingle();
  if(result.error||!result.data)throw new ApiError("The webhook result could not be committed.",500,"DATABASE_BINDING_FAILED");
}

export async function failWebhookEvent(db:SupabaseClient,input:{eventId:string;code:string;message:string}){
  await db.from("webhook_events").update({status:"failed",error_code:input.code,error_message:input.message.slice(0,500)}).eq("id",input.eventId).eq("status","processing");
}

export function requireWebhookMutation(result:{error?:unknown},message:string){if(result.error)throw new ApiError(message,500,"DATABASE_BINDING_FAILED");}
