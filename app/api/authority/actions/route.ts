import {z} from "zod";

import {ApiError,jsonError} from "@/lib/api/errors";
import {auditEvent,enforceRateLimit} from "@/lib/automation/control-plane";
import {requireLiveAgencyProject} from "@/lib/auth/live-tenant";
import {env} from "@/lib/config/env";
import {claimMutationIntent,decideMutationIntent,mutationDigest,requestMutationIntent,settleMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";

const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("approve"),projectId:z.string().uuid(),outreachId:z.string().uuid()}),
  z.object({action:z.literal("send"),projectId:z.string().uuid(),outreachId:z.string().uuid(),confirm:z.literal(true)}),
]);

function exactOutreachAction(row:Record<string,unknown>,tenant:{agencyId:string;clientId:string;projectId:string}):MutationAction{
  if(typeof row.contact_email!=="string"||!row.contact_email.trim())throw new ApiError("A verified contact email is required.",400,"VALIDATION_ERROR");
  if(typeof row.subject!=="string"||!row.subject.trim()||typeof row.message!=="string"||!row.message.trim())throw new ApiError("A complete outreach subject and message are required before approval.",409,"CONFLICT");
  return{agencyId:tenant.agencyId,clientId:tenant.clientId,projectId:tenant.projectId,toolKey:"authority.outreach",resourceType:"authority_outreach",resourceId:String(row.id),environment:"external",payload:{outreachId:row.id,to:row.contact_email.trim().toLowerCase(),subject:row.subject,message:row.message,targetUrl:row.target_url??null,outreachType:row.outreach_type,estimatedCost:row.estimated_cost??0}};
}

export async function POST(request:Request){try{
  const input=schema.parse(await request.json()),context=await requireLiveAgencyProject({projectId:input.projectId,permission:"execution.approve"});
  await enforceRateLimit(`authority:${context.agencyId}:${context.project.id}`,input.action,input.action==="send"?10:30,3600);
  const outreach=await context.db.from("authority_outreach_actions").select("*").eq("id",input.outreachId).eq("agency_id",context.agencyId).eq("client_organization_id",context.clientId).eq("project_id",context.project.id).maybeSingle();
  if(!outreach.data)throw new ApiError("Authority outreach not found.",404,"NOT_FOUND");
  const action=exactOutreachAction(outreach.data,{agencyId:context.agencyId,clientId:context.clientId,projectId:context.project.id}),digest=mutationDigest(action);
  let result:Record<string,unknown>;
  if(input.action==="approve"){
    if(outreach.data.status!=="awaiting_approval")throw new ApiError("This message is not awaiting approval.",409,"CONFLICT");
    const intent=await requestMutationIntent(context.db,{action,summary:`Send the exact reviewed outreach message to ${action.payload.to}.`,riskLevel:"high",approvalPolicy:"human",requestedBy:null,idempotencyKey:`mutation:authority-outreach:${input.outreachId}:${digest}`,expiresInMinutes:24*60}),approved=intent.status==="awaiting"?await decideMutationIntent(context.db,{intentId:intent.id,agencyId:context.agencyId,projectId:context.project.id,actorId:context.userId,decision:"approved",confirmation:`APPROVE ${intent.action_digest.slice(0,12)}`}):intent;
    if(!["approved","executing"].includes(approved.status))throw new ApiError("This exact outreach message was not approved.",409,"APPROVAL_REQUIRED");
    const saved=await context.db.from("authority_outreach_actions").update({status:"approved",approved_by:context.userId,approved_at:new Date().toISOString(),mutation_intent_id:intent.id,action_digest:digest,updated_at:new Date().toISOString()}).eq("id",input.outreachId).eq("status","awaiting_approval").select("id,status,mutation_intent_id,action_digest").maybeSingle();
    if(saved.error||!saved.data)throw new ApiError("The exact outreach approval could not be bound to the message.",500,"DATABASE_BINDING_FAILED");
    result=saved.data;
  }else{
    if(outreach.data.status==="sent"&&outreach.data.external_message_id)return Response.json({ok:true,result:{id:input.outreachId,status:"sent",messageId:outreach.data.external_message_id,duplicate:true}});
    if(outreach.data.status!=="approved"||outreach.data.action_digest!==digest||!outreach.data.mutation_intent_id)throw new ApiError("Approve this exact outreach message before sending it.",409,"APPROVAL_REQUIRED");
    if(!env.RESEND_API_KEY||!env.RESEND_FROM_EMAIL)throw new ApiError("Resend email delivery is not configured.",503,"NOT_CONFIGURED");
    const executionRef=`authority-outreach:${input.outreachId}`;
    await claimMutationIntent(context.db,{intentId:outreach.data.mutation_intent_id,action,executionRef});
    let messageId:string|null=null;
    try{
      const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json","Idempotency-Key":`hdseo-outreach-${input.outreachId}-${digest.slice(0,16)}`},body:JSON.stringify({from:env.RESEND_FROM_EMAIL,to:[action.payload.to],subject:action.payload.subject,text:action.payload.message,headers:{"X-Entity-Ref-ID":input.outreachId}})}),body=await response.json().catch(()=>null) as {id?:string;message?:string}|null;
      if(!response.ok||!body?.id)throw new ApiError("The approved outreach message could not be delivered.",502,"OPERATION_FAILED");
      messageId=body.id;
      const saved=await context.db.from("authority_outreach_actions").update({status:"sent",external_message_id:messageId,sent_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",input.outreachId).eq("status","approved").eq("action_digest",digest).select("id,status").maybeSingle();
      if(saved.error||!saved.data)throw new ApiError("The outreach was delivered but requires ledger reconciliation before retrying.",503,"DATABASE_BINDING_FAILED");
      await settleMutationIntent(context.db,{intentId:outreach.data.mutation_intent_id,executionRef,status:"succeeded"});
      result={id:input.outreachId,status:"sent",messageId};
    }catch(error){
      if(!messageId)await settleMutationIntent(context.db,{intentId:outreach.data.mutation_intent_id,executionRef,status:"failed",errorCode:error instanceof ApiError?error.code:"OPERATION_FAILED",errorMessage:error instanceof Error?error.message:"Outreach delivery failed."}).catch(()=>undefined);
      throw error;
    }
  }
  await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`authority.outreach.${input.action}`,resourceType:"authority_outreach",resourceId:input.outreachId,afterState:{...result,actionDigest:digest},request});
  return Response.json({ok:true,result});
}catch(error){if(error instanceof z.ZodError)return jsonError(new ApiError(error.issues[0]?.message??"Invalid authority action.",400,"VALIDATION_ERROR"));return jsonError(error)}}
