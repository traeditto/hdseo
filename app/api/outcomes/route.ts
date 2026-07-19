import { z } from "zod";
import { ApiError,jsonError } from "@/lib/api/errors";
import { auditEvent,enforceRateLimit } from "@/lib/automation/control-plane";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import { configureBudget,draftAuthorityOutreach,ingestLead,outcomesSnapshot,recordBudgetTransaction,saveCitation } from "@/lib/outcomes/service";

const categories=z.enum(["data","content","technical","local","authority","implementation","software","reserve"]);
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("configure_budget"),projectId:z.string().uuid(),monthlyLimit:z.number().min(0).max(10_000_000),warningPercent:z.number().min(1).max(100).default(80),hardStop:z.boolean().default(true),allocations:z.array(z.object({category:categories,monthlyAmount:z.number().min(0),approvalThreshold:z.number().min(0).default(0)})).max(8)}),
  z.object({action:z.literal("record_spend"),projectId:z.string().uuid(),category:categories,transactionType:z.enum(["actual","commitment","credit","adjustment"]),provider:z.string().trim().min(2).max(80),description:z.string().trim().min(3).max(500),amount:z.number().min(0).max(10_000_000),externalId:z.string().max(300).optional(),idempotencyKey:z.string().min(8).max(300),metadata:z.record(z.string(),z.unknown()).optional()}),
  z.object({action:z.literal("record_lead"),projectId:z.string().uuid(),source:z.string().trim().min(2).max(80),externalId:z.string().min(1).max(300),landingPageUrl:z.string().url().optional(),query:z.string().max(500).optional(),leadType:z.enum(["form","call","chat","booking","sale","other"]),status:z.string().trim().min(2).max(80),qualified:z.boolean().optional(),revenue:z.number().min(0).optional(),grossProfit:z.number().min(0).optional(),occurredAt:z.string().datetime(),metadata:z.record(z.string(),z.unknown()).optional()}),
  z.object({action:z.literal("save_citation"),projectId:z.string().uuid(),provider:z.string().trim().min(2).max(80),directoryName:z.string().trim().min(2).max(160),listingUrl:z.string().url().optional(),name:z.string().max(200).optional(),address:z.string().max(500).optional(),phone:z.string().max(60).optional(),websiteUrl:z.string().url().optional(),napConsistent:z.boolean().optional(),claimed:z.boolean().optional(),status:z.enum(["discovered","needs_claim","needs_correction","consistent","submitted","verified","unavailable"]),issueCodes:z.array(z.string().max(80)).max(30).optional(),evidence:z.record(z.string(),z.unknown()).optional()}),
  z.object({action:z.literal("draft_outreach"),projectId:z.string().uuid(),authorityOpportunityId:z.string().uuid().optional(),contactName:z.string().max(160).optional(),contactEmail:z.string().email().optional(),organization:z.string().max(200).optional(),targetUrl:z.string().url().optional(),outreachType:z.enum(["expert_quote","resource_suggestion","partnership","sponsorship","association","unlinked_mention","digital_pr"]),subject:z.string().trim().min(3).max(200),message:z.string().trim().min(20).max(8000),estimatedCost:z.number().min(0).max(1_000_000).default(0),idempotencyKey:z.string().min(8).max(300),evidence:z.record(z.string(),z.unknown()).optional()})
]);

export async function GET(request:Request){try{const projectId=new URL(request.url).searchParams.get("projectId");if(!projectId)throw new ApiError("Choose a client project.",400,"VALIDATION_ERROR");const context=await requireLiveAgencyProject({projectId});return Response.json({ok:true,data:await outcomesSnapshot(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId})});}catch(error){return jsonError(error)}}

export async function POST(request:Request){try{const input=schema.parse(await request.json()),permission=input.action==="record_lead"?"seo.write":input.action==="save_citation"?"seo.write":input.action==="draft_outreach"?"execution.approve":"provider.authorize",context=await requireLiveAgencyProject({projectId:input.projectId,permission});await enforceRateLimit(`outcomes:${context.agencyId}:${context.userId}`,input.action,60,60);const tenant={agencyId:context.agencyId,clientId:context.clientId,projectId:context.project.id,userId:context.userId};let result:unknown;
  if(input.action==="configure_budget")result=await configureBudget(context.db,tenant,input);
  else if(input.action==="record_spend")result=await recordBudgetTransaction(context.db,tenant,input);
  else if(input.action==="record_lead")result=await ingestLead(context.db,tenant,input);
  else if(input.action==="save_citation")result=await saveCitation(context.db,tenant,input);
  else result=await draftAuthorityOutreach(context.db,tenant,input);
  await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:`outcomes.${input.action}`,resourceType:"seo_project",resourceId:context.project.id,afterState:{result},request});
  return Response.json({ok:true,result,data:await outcomesSnapshot(context.db,tenant)});
}catch(error){if(error instanceof z.ZodError)return jsonError(new ApiError(error.issues[0]?.message??"Invalid outcome request.",400,"VALIDATION_ERROR"));return jsonError(error)}}
