import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { decryptSecret,encryptSecret } from "@/lib/security/encryption";
import { googleAccess,type GoogleConnection } from "@/lib/google/connection";
import { googleFetch,type GoogleCredentials } from "@/lib/google/search-console";

export const GOOGLE_ANALYTICS_SCOPES=["https://www.googleapis.com/auth/analytics.readonly","openid","email"];
export const GOOGLE_BUSINESS_SCOPES=["https://www.googleapis.com/auth/business.manage","openid","email"];

export async function loadSuiteConnection(db:SupabaseClient,input:{agencyId:string;clientId:string;projectId:string;provider:"google_analytics"|"google_business_profile"}){
  const result=await db.from("integration_connections").select("id,agency_id,client_organization_id,project_id,selected_resource,encrypted_secret_reference,status,last_synced_at,metadata").eq("agency_id",input.agencyId).eq("client_organization_id",input.clientId).eq("project_id",input.projectId).eq("provider",input.provider).eq("status","active").maybeSingle();
  if(!result.data?.encrypted_secret_reference)throw new ApiError(`Connect ${input.provider==="google_analytics"?"Google Analytics":"Google Business Profile"} first.`,409,"NOT_CONFIGURED");return result.data as GoogleConnection;
}

export async function suiteAccess(db:SupabaseClient,connection:GoogleConnection){return googleAccess(db,connection)}

export async function listAnalyticsProperties(accessToken:string){
  const response=await googleFetch<{accountSummaries?:Array<{account?:string;displayName?:string;propertySummaries?:Array<{property?:string;displayName?:string;propertyType?:string}>}>}>("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",accessToken);
  return(response.accountSummaries??[]).flatMap(account=>(account.propertySummaries??[]).flatMap(property=>property.property?[{property:property.property,propertyId:property.property.replace(/^properties\//,""),displayName:property.displayName??property.property,account:account.account??null,accountName:account.displayName??null}]:[]));
}

export async function runAnalyticsReport(accessToken:string,property:string,startDate="90daysAgo",endDate="yesterday"){
  const name=property.startsWith("properties/")?property:`properties/${property}`;
  return googleFetch<{dimensionHeaders?:Array<{name:string}>;metricHeaders?:Array<{name:string}>;rows?:Array<{dimensionValues?:Array<{value?:string}>;metricValues?:Array<{value?:string}>}>}>(`https://analyticsdata.googleapis.com/v1beta/${name}:runReport`,accessToken,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dateRanges:[{startDate,endDate}],dimensions:[{name:"date"},{name:"landingPagePlusQueryString"},{name:"sessionSource"},{name:"sessionMedium"}],metrics:[{name:"sessions"},{name:"conversions"},{name:"totalRevenue"}],dimensionFilter:{filter:{fieldName:"sessionMedium",stringFilter:{matchType:"EXACT",value:"organic",caseSensitive:false}}},limit:"100000"})});
}

export async function listBusinessAccounts(accessToken:string){
  const response=await googleFetch<{accounts?:Array<{name?:string;accountName?:string;type?:string;verificationState?:string}>}>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts",accessToken);return(response.accounts??[]).filter(item=>item.name);
}

const LOCATION_MASK="name,title,storeCode,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,serviceArea,metadata,openInfo";
export async function listBusinessLocations(accessToken:string,accountName:string){
  const response=await googleFetch<{locations?:Array<Record<string,unknown>>;nextPageToken?:string}>(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${encodeURIComponent(LOCATION_MASK)}&pageSize=100`,accessToken);return response.locations??[];
}

export async function listBusinessReviews(accessToken:string,accountName:string,locationName:string){
  const locationId=locationName.split("/").pop();
  try{return await googleFetch<{reviews?:Array<Record<string,unknown>>}>(`https://mybusiness.googleapis.com/v4/${accountName}/locations/${locationId}/reviews?pageSize=50`,accessToken);}catch{return{reviews:[]};}
}

export async function updateBusinessLocation(accessToken:string,locationName:string,updateMask:string,patch:Record<string,unknown>){
  const allowed=new Set(["regularHours","specialHours","phoneNumbers","websiteUri","serviceArea","categories","attributes"]),fields=updateMask.split(",").map(item=>item.trim()).filter(Boolean);if(!fields.length||fields.some(field=>!allowed.has(field)))throw new ApiError("The Business Profile update contains a field HD SEO is not authorized to change.",400,"VALIDATION_ERROR");
  return googleFetch<Record<string,unknown>>(`https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?updateMask=${encodeURIComponent(fields.join(","))}`,accessToken,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(patch)});
}

export async function publishBusinessReviewReply(accessToken:string,accountName:string,locationName:string,reviewId:string,comment:string){
  const locationId=locationName.split("/").pop();return googleFetch<Record<string,unknown>>(`https://mybusiness.googleapis.com/v4/${accountName}/locations/${locationId}/reviews/${encodeURIComponent(reviewId)}/reply`,accessToken,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({comment})});
}

export function credentialsFromEncrypted(value:string){return JSON.parse(decryptSecret(value)) as GoogleCredentials}
export function encryptedCredentials(value:GoogleCredentials){return encryptSecret(JSON.stringify(value))}
export function stableFingerprint(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex")}

export async function syncAnalytics(db:SupabaseClient,tenant:{agencyId:string;clientId:string;projectId:string}){
  const connection=await loadSuiteConnection(db,{...tenant,provider:"google_analytics"}),accessToken=await suiteAccess(db,connection),property=connection.selected_resource;if(!property)throw new ApiError("Choose a GA4 property before syncing.",409,"PROPERTY_NOT_AUTHORIZED");
  const run=await db.from("provider_sync_runs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,connection_id:connection.id,provider:"google_analytics",operation:"daily_metrics"}).select("id").single();
  try{const report=await runAnalyticsReport(accessToken,property),rows=(report.rows??[]).map(row=>{const[d,landing,source,medium]=row.dimensionValues??[],[sessions,conversions,revenue]=row.metricValues??[];const raw=d?.value??"";return{agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,provider:"ga4",metric_date:raw.length===8?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:new Date().toISOString().slice(0,10),landing_page:landing?.value??"",source:source?.value??"",medium:medium?.value??"",campaign:"",sessions:Number(sessions?.value)||0,organic_sessions:Number(sessions?.value)||0,conversions:Number(conversions?.value)||0,revenue:Number(revenue?.value)||0,metadata:{property},captured_at:new Date().toISOString()}});if(rows.length){const saved=await db.from("analytics_daily_metrics").upsert(rows,{onConflict:"project_id,provider,metric_date,landing_page,source,medium,campaign"});if(saved.error)throw saved.error;}await db.from("provider_sync_runs").update({status:"succeeded",records_read:rows.length,records_written:rows.length,completed_at:new Date().toISOString()}).eq("id",run.data?.id);await db.from("integration_connections").update({last_synced_at:new Date().toISOString(),last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",connection.id);return{records:rows.length,property};}catch(error){await db.from("provider_sync_runs").update({status:"failed",error_code:"GOOGLE_API_FAILED",error_message:"Google Analytics synchronization failed.",completed_at:new Date().toISOString()}).eq("id",run.data?.id);throw error;}
}

export async function syncBusinessProfile(db:SupabaseClient,tenant:{agencyId:string;clientId:string;projectId:string}){
  const connection=await loadSuiteConnection(db,{...tenant,provider:"google_business_profile"}),accessToken=await suiteAccess(db,connection),account=String((connection.metadata as Record<string,unknown>)?.selectedAccount??"");if(!account)throw new ApiError("Choose a Business Profile account before syncing.",409,"PROPERTY_NOT_AUTHORIZED");
  const run=await db.from("provider_sync_runs").insert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,connection_id:connection.id,provider:"google_business_profile",operation:"locations_and_reviews"}).select("id").single();
  try{const locations=await listBusinessLocations(accessToken,account);let reviewsWritten=0;for(const raw of locations){const location=raw as Record<string,unknown>,name=String(location.name??"");if(!name)continue;const metadata=(location.metadata??{}) as Record<string,unknown>,category=(location.categories??{}) as Record<string,unknown>,primary=(category.primaryCategory??{}) as Record<string,unknown>;const completeness=[location.title,location.phoneNumbers,location.categories,location.storefrontAddress,location.websiteUri,location.regularHours].filter(Boolean).length/6*100;const saved=await db.from("local_business_profiles").upsert({agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,connection_id:connection.id,external_account_id:account,external_location_id:name,title:String(location.title??name),primary_category:String(primary.displayName??primary.name??""),additional_categories:(category.additionalCategories??[]),address:location.storefrontAddress??{},phone:String(((location.phoneNumbers??{}) as Record<string,unknown>).primaryPhone??""),website_url:location.websiteUri??null,regular_hours:location.regularHours??{},special_hours:location.specialHours??{},service_area:location.serviceArea??{},attributes:{},verification_state:String(metadata.hasVoiceOfMerchant??"unknown"),profile_completeness:+completeness.toFixed(2),status:"active",raw_fingerprint:stableFingerprint(location),last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"project_id,external_location_id"}).select("id").single();if(!saved.data)continue;const reviewResult=await listBusinessReviews(accessToken,account,name),reviews=(reviewResult.reviews??[]).map(item=>{const review=item as Record<string,unknown>,reviewer=(review.reviewer??{}) as Record<string,unknown>,reply=(review.reviewReply??{}) as Record<string,unknown>,rating=String(review.starRating??"");const ratingMap:Record<string,number>={ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5};return{agency_id:tenant.agencyId,client_organization_id:tenant.clientId,project_id:tenant.projectId,profile_id:saved.data.id,provider:"google",external_review_id:String(review.reviewId??review.name),reviewer_name:String(reviewer.displayName??""),star_rating:ratingMap[rating]??null,comment:review.comment??null,reply_text:reply.comment??null,replied_at:reply.updateTime??null,review_created_at:review.createTime??null,review_updated_at:review.updateTime??null,response_status:reply.comment?"published":"unanswered",metadata:{name:review.name},captured_at:new Date().toISOString(),updated_at:new Date().toISOString()}});if(reviews.length){const written=await db.from("local_reviews").upsert(reviews,{onConflict:"profile_id,external_review_id"});if(!written.error)reviewsWritten+=reviews.length;}}
    await db.from("provider_sync_runs").update({status:"succeeded",records_read:locations.length+reviewsWritten,records_written:locations.length+reviewsWritten,completed_at:new Date().toISOString()}).eq("id",run.data?.id);await db.from("integration_connections").update({last_synced_at:new Date().toISOString(),last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",connection.id);return{locations:locations.length,reviews:reviewsWritten};
  }catch(error){await db.from("provider_sync_runs").update({status:"failed",error_code:"GOOGLE_API_FAILED",error_message:"Business Profile synchronization failed.",completed_at:new Date().toISOString()}).eq("id",run.data?.id);throw error;}
}
