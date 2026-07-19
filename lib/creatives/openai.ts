import "server-only";
import {z} from "zod";
import {env} from "@/lib/config/env";
import {ApiError,logServerError} from "@/lib/api/errors";
import type {SupabaseClient} from "@supabase/supabase-js";
import {calculateModelCost,estimateMaximumModelCost,reserveModelCost,settleModelCost,type CostTenant,type TokenUsage} from "@/lib/agent-service/cost-control";

const section=z.object({heading:z.string().min(2),purpose:z.string().min(2),body:z.string().min(40),evidenceIds:z.array(z.string().uuid())});
const faq=z.object({question:z.string().min(5),answer:z.string().min(20)});
const link=z.object({anchor:z.string().min(2),targetUrl:z.string().min(1),reason:z.string().min(2)});
const generatedSchema=z.object({
  title:z.string().min(10).max(70),metaDescription:z.string().min(50).max(180),h1:z.string().min(5).max(120),summary:z.string().min(40),
  sections:z.array(section).min(3),faqs:z.array(faq).max(8),internalLinks:z.array(link).max(12),schemaMarkup:z.object({types:z.array(z.string()),jsonLd:z.string()}),
  cta:z.object({label:z.string().min(2),supportingText:z.string().min(5)}),claimIdsUsed:z.array(z.string().uuid()),proofAssetIdsUsed:z.array(z.string().uuid())
});
export type GeneratedCreative=z.infer<typeof generatedSchema>;

const jsonSchema={type:"object",additionalProperties:false,required:["title","metaDescription","h1","summary","sections","faqs","internalLinks","schemaMarkup","cta","claimIdsUsed","proofAssetIdsUsed"],properties:{
  title:{type:"string"},metaDescription:{type:"string"},h1:{type:"string"},summary:{type:"string"},
  sections:{type:"array",minItems:3,items:{type:"object",additionalProperties:false,required:["heading","purpose","body","evidenceIds"],properties:{heading:{type:"string"},purpose:{type:"string"},body:{type:"string"},evidenceIds:{type:"array",items:{type:"string",format:"uuid"}}}}},
  faqs:{type:"array",items:{type:"object",additionalProperties:false,required:["question","answer"],properties:{question:{type:"string"},answer:{type:"string"}}}},
  internalLinks:{type:"array",items:{type:"object",additionalProperties:false,required:["anchor","targetUrl","reason"],properties:{anchor:{type:"string"},targetUrl:{type:"string"},reason:{type:"string"}}}},
  schemaMarkup:{type:"object",additionalProperties:false,required:["types","jsonLd"],properties:{types:{type:"array",items:{type:"string"}},jsonLd:{type:"string"}}},cta:{type:"object",additionalProperties:false,required:["label","supportingText"],properties:{label:{type:"string"},supportingText:{type:"string"}}},
  claimIdsUsed:{type:"array",items:{type:"string",format:"uuid"}},proofAssetIdsUsed:{type:"array",items:{type:"string",format:"uuid"}}
}};

function outputText(payload:Record<string,unknown>){
  if(typeof payload.output_text==="string")return payload.output_text;
  const output=Array.isArray(payload.output)?payload.output:[];
  for(const item of output){if(!item||typeof item!=="object")continue;const content=Array.isArray((item as {content?:unknown[]}).content)?(item as {content:unknown[]}).content:[];for(const part of content){if(part&&typeof part==="object"&&typeof (part as {text?:unknown}).text==="string")return (part as {text:string}).text;}}
  return "";
}

export async function generateEvidenceConstrainedCreative(input:Record<string,unknown>,costContext:{db:SupabaseClient;tenant:CostTenant;idempotencyKey:string}){
  if(!env.OPENAI_API_KEY)throw new ApiError("Connect the HD SEO creative model before generating production copy.",503,"NOT_CONFIGURED");
  const referenceId=crypto.randomUUID(),serialized=JSON.stringify(input),estimatedCost=estimateMaximumModelCost(env.OPENAI_CREATIVE_MODEL,serialized,env.OPENAI_CREATIVE_MAX_OUTPUT_TOKENS);
  const reservation=await reserveModelCost(costContext.db,costContext.tenant,{operation:"creative.generate",model:env.OPENAI_CREATIVE_MODEL,estimatedCost,idempotencyKey:costContext.idempotencyKey,metadata:{referenceId}});
  try{
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,"content-type":"application/json",...(env.OPENAI_PROJECT_ID?{"OpenAI-Project":env.OPENAI_PROJECT_ID}:{})},body:JSON.stringify({
      model:env.OPENAI_CREATIVE_MODEL,store:false,reasoning:{effort:"low"},max_output_tokens:env.OPENAI_CREATIVE_MAX_OUTPUT_TOKENS,
      instructions:"You are HD SEO's production Content Agent. Create useful, specific, people-first copy that directly satisfies the supplied search intent. Use ONLY verified proof and approved claims in the input. Never invent jobs, people, reviews, credentials, prices, guarantees, years in business, service areas, or performance results. Do not use empty superlatives. If evidence is insufficient, omit the claim. Each section must list the exact proof or claim IDs that support it; use an empty list only for purely instructional language. Every claimIdsUsed, proofAssetIdsUsed, and evidenceIds value must be copied exactly from the supplied records. Follow the required sections, page ownership, internal-link plan, and restrictions. Return only the requested structured object.",
      input:serialized,text:{format:{type:"json_schema",name:"hd_seo_creative",strict:true,schema:jsonSchema}}
    })});
    const payload=await response.json() as Record<string,unknown>;
    if(!response.ok)throw new Error(`OpenAI Responses API returned ${response.status}.`);
    const text=outputText(payload);if(!text)throw new Error("Creative response did not contain structured output.");
    const rawUsage=payload.usage&&typeof payload.usage==="object"?payload.usage as Record<string,unknown>:{},details=rawUsage.input_tokens_details&&typeof rawUsage.input_tokens_details==="object"?rawUsage.input_tokens_details as Record<string,unknown>:{};
    const usage:TokenUsage={inputTokens:Math.max(0,Number(rawUsage.input_tokens)||0),cachedInputTokens:Math.max(0,Number(details.cached_tokens)||0),outputTokens:Math.max(0,Number(rawUsage.output_tokens)||0)},actualCost=calculateModelCost(env.OPENAI_CREATIVE_MODEL,usage);
    await settleModelCost(costContext.db,reservation,{status:"completed",actualCost,usage,metadata:{responseId:typeof payload.id==="string"?payload.id:null}});
    return{creative:generatedSchema.parse(JSON.parse(text)),responseId:typeof payload.id==="string"?payload.id:null,model:env.OPENAI_CREATIVE_MODEL,usage,actualCost};
  }catch(error){await settleModelCost(costContext.db,reservation,{status:"failed",actualCost:0,metadata:{referenceId}}).catch(()=>undefined);logServerError("creative_generation_failed",error,{referenceId,provider:"openai",operation:"creative.generate"});throw new ApiError("The creative could not be generated safely. No draft was saved.",502,"CREATIVE_GENERATION_FAILED",referenceId);}
}
