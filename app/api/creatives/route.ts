import{z}from"zod";
import{ApiError,jsonError}from"@/lib/api/errors";
import{parseJson}from"@/lib/api/request";
import{requireLiveAgencyProject}from"@/lib/auth/live-tenant";
import{auditEvent,enforceRateLimit}from"@/lib/automation/control-plane";
import{addBusinessProof,approveCreativeDraft,createCreativeSpec,creativeWorkspaceSnapshot,generateCreativeDraft,verifyBusinessProof}from"@/lib/creatives/service";

const proofTypes=["project","photo","voice_note","credential","review","process","material","warranty","pricing_factor","faq","service_area","case_study","other"]as const;
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("add_proof"),projectId:z.string().uuid(),proofType:z.enum(proofTypes),title:z.string().trim().min(3).max(160),summary:z.string().trim().min(10).max(5000),sourceUrl:z.string().url().max(1000).optional().or(z.literal("")),service:z.string().trim().max(160).optional(),location:z.string().trim().max(160).optional(),facts:z.record(z.string(),z.unknown()).optional()}),
  z.object({action:z.literal("verify_proof"),projectId:z.string().uuid(),proofId:z.string().uuid(),decision:z.enum(["verified","rejected"])}),
  z.object({action:z.literal("create_spec"),projectId:z.string().uuid(),opportunityId:z.string().uuid()}),
  z.object({action:z.literal("generate_draft"),projectId:z.string().uuid(),specId:z.string().uuid()}),
  z.object({action:z.literal("approve_draft"),projectId:z.string().uuid(),draftId:z.string().uuid()}),
  z.object({action:z.literal("record_lead"),projectId:z.string().uuid(),source:z.string().min(2).max(100),landingPageUrl:z.string().url().optional(),leadType:z.string().max(80).default("form"),externalId:z.string().max(200).optional(),status:z.string().max(80).default("new"),qualified:z.boolean().optional(),revenue:z.number().min(0).max(100000000).optional(),grossProfit:z.number().min(0).max(100000000).optional()}),
]);

export async function GET(request:Request){try{const projectId=new URL(request.url).searchParams.get("projectId");if(!projectId||!z.string().uuid().safeParse(projectId).success)throw new ApiError("Choose a client project.",400,"VALIDATION_ERROR");const context=await requireLiveAgencyProject({projectId,permission:"seo.read"});return Response.json({ok:true,workspace:await creativeWorkspaceSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId})});}catch(error){return jsonError(error)}}

export async function POST(request:Request){try{
  const input=await parseJson(request,schema),permission=input.action==="approve_draft"||input.action==="verify_proof"?"draft.approve":"seo.write",context=await requireLiveAgencyProject({projectId:input.projectId,permission});
  await enforceRateLimit(`agency:${context.agencyId}:project:${input.projectId}`,`creatives_${input.action}`,input.action==="generate_draft"?20:100,3600);
  const tenant={agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId,userId:context.userId};let resourceId:string|undefined;
  if(input.action==="add_proof")resourceId=(await addBusinessProof(context.db,tenant,{...input,sourceUrl:input.sourceUrl||undefined})).id;
  else if(input.action==="verify_proof")resourceId=(await verifyBusinessProof(context.db,tenant,input.proofId,input.decision)).id;
  else if(input.action==="create_spec")resourceId=(await createCreativeSpec(context.db,tenant,input.opportunityId)).id;
  else if(input.action==="generate_draft")resourceId=(await generateCreativeDraft(context.db,tenant,input.specId)).id;
  else if(input.action==="approve_draft")resourceId=(await approveCreativeDraft(context.db,tenant,input.draftId)).id;
  else{const row={agency_id:context.agencyId,client_organization_id:context.clientId,project_id:input.projectId,source:input.source,landing_page_url:input.landingPageUrl??null,lead_type:input.leadType,external_id:input.externalId??null,status:input.status,qualified:input.qualified??null,revenue:input.revenue??null,gross_profit:input.grossProfit??null,occurred_at:new Date().toISOString(),updated_at:new Date().toISOString()};let saved;if(input.externalId){const existing=await context.db.from("seo_leads").select("id").eq("project_id",input.projectId).eq("source",input.source).eq("external_id",input.externalId).maybeSingle();saved=existing.data?await context.db.from("seo_leads").update(row).eq("id",existing.data.id).select("id").single():await context.db.from("seo_leads").insert(row).select("id").single();}else saved=await context.db.from("seo_leads").insert(row).select("id").single();if(saved.error||!saved.data)throw new ApiError("Lead attribution could not be saved.",500,"DATABASE_BINDING_FAILED");resourceId=saved.data.id;}
  await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`creative.${input.action}`,resourceType:"seo_creative",resourceId,request,afterState:{projectId:input.projectId}});
  return Response.json({ok:true,workspace:await creativeWorkspaceSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId:input.projectId})});
}catch(error){return jsonError(error)}}
