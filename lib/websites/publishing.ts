import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError,logServerError } from "@/lib/api/errors";
import { decryptSecret } from "@/lib/security/encryption";
import { normalizeSiteUrl } from "@/lib/websites/url-security";
import {actionDigest} from "@/lib/safety/action-digest";
import {implementationPackageDigest} from "@/lib/safety/package-approval";
import {claimStoredMutationIntent,requestMutationIntent,settleMutationIntent,type MutationAction} from "@/lib/safety/mutation-gateway";

type Provider="wordpress"|"shopify"|"webflow";
type ConnectionSecret={version:1;provider:Provider;username?:string;applicationPassword?:string;accessToken?:string;siteId?:string;shop?:string};
type PublicationPayload={targetUrl:string;title?:string;metaDescription?:string;html?:string;providerResourceId?:string};
type ProviderWrite={resourceType:string;resourceId:string;before:Record<string,unknown>;after:Record<string,unknown>;result:Record<string,unknown>};
type ProviderContext={provider:Provider;siteUrl:string;secret:ConnectionSecret;payload:PublicationPayload};

function assertProviderUnchanged(current:Record<string,unknown>,expected:Record<string,unknown>){if(actionDigest(current)!==actionDigest(expected))throw new ApiError("The page changed after HD SEO published it. Rollback stopped to protect the newer edits.",409,"INVALID_STATE");}

function cleanPath(value:string){const path=new URL(value).pathname.replace(/\/+$/,"/");return path==="/"?"/":path.replace(/\/$/,"");}
function slugFromUrl(value:string){return cleanPath(value).split("/").filter(Boolean).at(-1)??"";}
function basicAuth(secret:ConnectionSecret){
  if(!secret.username||!secret.applicationPassword)throw new ApiError("Stored WordPress credentials are incomplete.",409,"WEBSITE_CONNECTION_FAILED");
  return`Basic ${Buffer.from(`${secret.username}:${secret.applicationPassword.replace(/\s+/g,"")}`).toString("base64")}`;
}
function bearer(secret:ConnectionSecret){if(!secret.accessToken)throw new ApiError("Stored provider credentials are incomplete.",409,"WEBSITE_CONNECTION_FAILED");return`Bearer ${secret.accessToken}`;}
async function providerFetch(url:string,init:RequestInit,provider:Provider){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  try{
    const response=await fetch(url,{...init,signal:controller.signal,redirect:"error",cache:"no-store"});
    if(response.status===401||response.status===403)throw new ApiError(`${provider} rejected the stored publishing credentials.`,401,"WEBSITE_CONNECTION_FAILED");
    if(response.status===429)throw new ApiError(`${provider} rate-limited the publishing request. Retry after the provider window resets.`,429,"RATE_LIMITED");
    return response;
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(`${provider} could not be reached for publishing.`,502,"WEBSITE_CONNECTION_FAILED");}
  finally{clearTimeout(timer);}
}
async function json<T>(response:Response,provider:Provider){
  const body=await response.json().catch(()=>null) as T|null;
  if(!response.ok||!body)throw new ApiError(`${provider} publishing failed with HTTP ${response.status}.`,502,"OPERATION_FAILED");
  return body;
}

type WpPage={id:number;link:string;slug:string;status:string;title:{raw?:string;rendered?:string};content:{raw?:string;rendered?:string};excerpt:{raw?:string;rendered?:string};modified_gmt?:string};
async function wordpressPage(context:ProviderContext,id?:string){
  const base=normalizeSiteUrl(context.siteUrl).siteUrl,headers={Accept:"application/json",Authorization:basicAuth(context.secret)};
  if(id){const response=await providerFetch(`${base}/wp-json/wp/v2/pages/${encodeURIComponent(id)}?context=edit`,{headers},"wordpress");return json<WpPage>(response,"wordpress");}
  const slug=slugFromUrl(context.payload.targetUrl);
  let pageId:string|undefined;
  if(!slug){
    const settings=await json<{page_on_front?:number}>(await providerFetch(`${base}/wp-json/wp/v2/settings`,{headers},"wordpress"),"wordpress");
    if(settings.page_on_front)pageId=String(settings.page_on_front);
  }
  if(pageId)return wordpressPage(context,pageId);
  const pages=await json<WpPage[]>(await providerFetch(`${base}/wp-json/wp/v2/pages?context=edit&per_page=2&slug=${encodeURIComponent(slug)}`,{headers},"wordpress"),"wordpress");
  if(pages.length!==1)throw new ApiError("HD SEO could not resolve the target WordPress page uniquely.",409,"NOT_FOUND");
  return pages[0];
}
function wordpressSnapshot(page:WpPage){return{id:page.id,link:page.link,slug:page.slug,status:page.status,title:page.title.raw??page.title.rendered??"",content:page.content.raw??page.content.rendered??"",excerpt:page.excerpt.raw??page.excerpt.rendered??"",modifiedGmt:page.modified_gmt??null};}
async function publishWordPress(context:ProviderContext):Promise<ProviderWrite>{
  const current=await wordpressPage(context,context.payload.providerResourceId),before=wordpressSnapshot(current),body:Record<string,unknown>={};
  if(context.payload.title)body.title=context.payload.title;
  if(context.payload.html)body.content=context.payload.html;
  if(!Object.keys(body).length)throw new ApiError("The approved package has no WordPress title or body to publish.",409,"CONFLICT");
  const base=normalizeSiteUrl(context.siteUrl).siteUrl,response=await providerFetch(`${base}/wp-json/wp/v2/pages/${current.id}`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json",Authorization:basicAuth(context.secret)},body:JSON.stringify(body)},"wordpress"),updated=await json<WpPage>(response,"wordpress");
  return{resourceType:"page",resourceId:String(current.id),before,after:wordpressSnapshot(updated),result:{httpStatus:response.status,providerRevision:updated.modified_gmt??null}};
}
async function rollbackWordPress(context:ProviderContext,resourceId:string,before:Record<string,unknown>,expectedAfter:Record<string,unknown>):Promise<ProviderWrite>{
  const current=await wordpressPage(context,resourceId),currentSnapshot=wordpressSnapshot(current);assertProviderUnchanged(currentSnapshot,expectedAfter);const base=normalizeSiteUrl(context.siteUrl).siteUrl,body={title:String(before.title??""),content:String(before.content??""),excerpt:String(before.excerpt??""),status:String(before.status??current.status)};
  const response=await providerFetch(`${base}/wp-json/wp/v2/pages/${encodeURIComponent(resourceId)}`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json",Authorization:basicAuth(context.secret)},body:JSON.stringify(body)},"wordpress"),restored=await json<WpPage>(response,"wordpress");
  return{resourceType:"page",resourceId,before:currentSnapshot,after:wordpressSnapshot(restored),result:{httpStatus:response.status,providerRevision:restored.modified_gmt??null}};
}

function shopifyBase(secret:ConnectionSecret,siteUrl:string){const raw=(secret.shop??siteUrl).replace(/^https?:\/\//,"").replace(/\/$/,"").toLowerCase();if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(raw))throw new ApiError("Stored Shopify shop domain is invalid.",409,"WEBSITE_CONNECTION_FAILED");return`https://${raw}`;}
async function shopifyGraphql<T>(context:ProviderContext,query:string,variables:Record<string,unknown>){
  if(!context.secret.accessToken)throw new ApiError("Stored Shopify credentials are incomplete.",409,"WEBSITE_CONNECTION_FAILED");
  const response=await providerFetch(`${shopifyBase(context.secret,context.siteUrl)}/admin/api/2026-07/graphql.json`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json","X-Shopify-Access-Token":context.secret.accessToken},body:JSON.stringify({query,variables})},"shopify"),body=await json<{data?:T;errors?:Array<{message?:string}>}>(response,"shopify");
  if(body.errors?.length||!body.data)throw new ApiError("Shopify rejected the page operation.",502,"OPERATION_FAILED");
  return{data:body.data,httpStatus:response.status};
}
type ShopifyPage={id:string;title:string;handle:string;body:string;isPublished:boolean;updatedAt:string};
async function shopifyPage(context:ProviderContext,id?:string){
  if(id){const result=await shopifyGraphql<{page:ShopifyPage|null}>(context,`query HDSEOPage($id: ID!) { page(id: $id) { id title handle body isPublished updatedAt } }`,{id});if(!result.data.page)throw new ApiError("The Shopify page no longer exists.",404,"NOT_FOUND");return result.data.page;}
  const handle=slugFromUrl(context.payload.targetUrl);if(!handle)throw new ApiError("A Shopify page handle or provider resource ID is required.",409,"NOT_FOUND");
  const result=await shopifyGraphql<{pages:{nodes:ShopifyPage[]}}>(context,`query HDSEOPages($query: String!) { pages(first: 2, query: $query) { nodes { id title handle body isPublished updatedAt } } }`,{query:`handle:${handle}`});
  if(result.data.pages.nodes.length!==1)throw new ApiError("HD SEO could not resolve the target Shopify page uniquely.",409,"NOT_FOUND");return result.data.pages.nodes[0];
}
function shopifySnapshot(page:ShopifyPage){return{id:page.id,title:page.title,handle:page.handle,body:page.body,isPublished:page.isPublished,updatedAt:page.updatedAt};}
async function mutateShopifyPage(context:ProviderContext,id:string,page:Record<string,unknown>){
  const result=await shopifyGraphql<{pageUpdate:{page:ShopifyPage|null;userErrors:Array<{message:string}>}}>(context,`mutation HDSEOPageUpdate($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id title handle body isPublished updatedAt } userErrors { message } } }`,{id,page});
  if(result.data.pageUpdate.userErrors.length||!result.data.pageUpdate.page)throw new ApiError("Shopify rejected the approved page update.",409,"OPERATION_FAILED");
  return{page:result.data.pageUpdate.page,httpStatus:result.httpStatus};
}
async function publishShopify(context:ProviderContext):Promise<ProviderWrite>{
  const current=await shopifyPage(context,context.payload.providerResourceId),page:Record<string,unknown>={};if(context.payload.title)page.title=context.payload.title;if(context.payload.html)page.body=context.payload.html;
  if(!Object.keys(page).length)throw new ApiError("The approved package has no Shopify page title or body to publish.",409,"CONFLICT");
  const updated=await mutateShopifyPage(context,current.id,page);return{resourceType:"page",resourceId:current.id,before:shopifySnapshot(current),after:shopifySnapshot(updated.page),result:{httpStatus:updated.httpStatus,providerRevision:updated.page.updatedAt}};
}
async function rollbackShopify(context:ProviderContext,resourceId:string,before:Record<string,unknown>,expectedAfter:Record<string,unknown>):Promise<ProviderWrite>{
  const current=await shopifyPage(context,resourceId),currentSnapshot=shopifySnapshot(current);assertProviderUnchanged(currentSnapshot,expectedAfter);const restored=await mutateShopifyPage(context,resourceId,{title:String(before.title??""),body:String(before.body??""),isPublished:Boolean(before.isPublished)});
  return{resourceType:"page",resourceId,before:currentSnapshot,after:shopifySnapshot(restored.page),result:{httpStatus:restored.httpStatus,providerRevision:restored.page.updatedAt}};
}

type WebflowPage={id:string;siteId:string;title:string;slug:string;lastUpdated?:string;seo?:{title?:string;description?:string};openGraph?:Record<string,unknown>;localeId?:string|null;publishedPath?:string};
function webflowHeaders(context:ProviderContext){return{Accept:"application/json",Authorization:bearer(context.secret),"accept-version":"2.0.0"};}
async function webflowPage(context:ProviderContext,id?:string){
  if(!context.secret.siteId)throw new ApiError("Stored Webflow site information is incomplete.",409,"WEBSITE_CONNECTION_FAILED");
  if(id)return json<WebflowPage>(await providerFetch(`https://api.webflow.com/v2/pages/${encodeURIComponent(id)}`,{headers:webflowHeaders(context)},"webflow"),"webflow");
  const target=cleanPath(context.payload.targetUrl),slug=slugFromUrl(context.payload.targetUrl);let offset=0;
  while(offset<1000){const result=await json<{pages:WebflowPage[];pagination?:{total?:number}}>(await providerFetch(`https://api.webflow.com/v2/sites/${encodeURIComponent(context.secret.siteId)}/pages?limit=100&offset=${offset}`,{headers:webflowHeaders(context)},"webflow"),"webflow"),match=result.pages.filter(page=>cleanPath(new URL(page.publishedPath??`/${page.slug}`,context.siteUrl).toString())===target||page.slug===slug);if(match.length===1)return match[0];if(match.length>1)throw new ApiError("HD SEO found multiple matching Webflow pages.",409,"CONFLICT");offset+=100;if(offset>=(result.pagination?.total??result.pages.length))break;}
  throw new ApiError("The target Webflow page could not be found.",404,"NOT_FOUND");
}
function webflowSnapshot(page:WebflowPage){return{id:page.id,siteId:page.siteId,title:page.title,slug:page.slug,seo:page.seo??{},openGraph:page.openGraph??{},localeId:page.localeId??null,publishedPath:page.publishedPath??null,lastUpdated:page.lastUpdated??null};}
async function mutateWebflowMetadata(context:ProviderContext,id:string,payload:Record<string,unknown>){const locale=(payload.localeId as string|null|undefined),query=locale?`?localeId=${encodeURIComponent(locale)}`:"",body={seo:payload.seo,openGraph:payload.openGraph};const response=await providerFetch(`https://api.webflow.com/v2/pages/${encodeURIComponent(id)}${query}`,{method:"PUT",headers:{...webflowHeaders(context),"Content-Type":"application/json"},body:JSON.stringify(body)},"webflow");return{page:await json<WebflowPage>(response,"webflow"),httpStatus:response.status};}
async function publishWebflowPage(context:ProviderContext,pageId:string){
  if(!context.secret.siteId)throw new ApiError("Stored Webflow site information is incomplete.",409,"WEBSITE_CONNECTION_FAILED");
  const site=await json<{customDomains?:Array<{id:string;url:string}>;shortName?:string}>(await providerFetch(`https://api.webflow.com/v2/sites/${encodeURIComponent(context.secret.siteId)}`,{headers:webflowHeaders(context)},"webflow"),"webflow"),host=new URL(context.payload.targetUrl).hostname.replace(/^www\./,""),domains=(site.customDomains??[]).filter(item=>item.url.replace(/^www\./,"")===host).map(item=>item.id),publishToWebflowSubdomain=host.endsWith(".webflow.io");
  if(!domains.length&&!publishToWebflowSubdomain)throw new ApiError("The target domain is not attached to the connected Webflow site.",409,"WEBSITE_CONNECTION_FAILED");
  const response=await providerFetch(`https://api.webflow.com/v2/sites/${encodeURIComponent(context.secret.siteId)}/publish`,{method:"POST",headers:{...webflowHeaders(context),"Content-Type":"application/json"},body:JSON.stringify({customDomains:domains,publishToWebflowSubdomain,pageId})},"webflow");await json<Record<string,unknown>>(response,"webflow");return response.status;
}
async function publishWebflow(context:ProviderContext):Promise<ProviderWrite>{
  if(context.payload.html)throw new ApiError("Webflow static page body publishing requires explicit node IDs; this approved package is metadata-only.",409,"CONFLICT");
  if(!context.payload.title&&!context.payload.metaDescription)throw new ApiError("The approved package has no Webflow SEO metadata to publish.",409,"CONFLICT");
  const current=await webflowPage(context,context.payload.providerResourceId),seo={...(current.seo??{})};if(context.payload.title)seo.title=context.payload.title;if(context.payload.metaDescription)seo.description=context.payload.metaDescription;
  const updated=await mutateWebflowMetadata(context,current.id,{seo,openGraph:current.openGraph??{},localeId:current.localeId??null}),publishStatus=await publishWebflowPage(context,current.id);
  return{resourceType:"page",resourceId:current.id,before:webflowSnapshot(current),after:webflowSnapshot(updated.page),result:{httpStatus:updated.httpStatus,publishHttpStatus:publishStatus,providerRevision:updated.page.lastUpdated??null}};
}
async function rollbackWebflow(context:ProviderContext,resourceId:string,before:Record<string,unknown>,expectedAfter:Record<string,unknown>):Promise<ProviderWrite>{
  const current=await webflowPage(context,resourceId),currentSnapshot=webflowSnapshot(current);assertProviderUnchanged(currentSnapshot,expectedAfter);const restored=await mutateWebflowMetadata(context,resourceId,{seo:before.seo??{},openGraph:before.openGraph??{},localeId:before.localeId??null}),publishStatus=await publishWebflowPage(context,resourceId);
  return{resourceType:"page",resourceId,before:currentSnapshot,after:webflowSnapshot(restored.page),result:{httpStatus:restored.httpStatus,publishHttpStatus:publishStatus,providerRevision:restored.page.lastUpdated??null}};
}

function approvedPayload(pkg:Record<string,unknown>):PublicationPayload{
  const packageData=(pkg.package_data&&typeof pkg.package_data==="object"?pkg.package_data:{}) as Record<string,unknown>,publication=(packageData.publication&&typeof packageData.publication==="object"?packageData.publication:{}) as Record<string,unknown>,metadata=(packageData.metadata&&typeof packageData.metadata==="object"?packageData.metadata:{}) as Record<string,unknown>,targetUrl=String(publication.targetUrl??packageData.targetUrl??"");
  if(!targetUrl)throw new ApiError("The approved package does not identify a target URL.",409,"CONFLICT");
  const title=String(publication.title??metadata.title??"").trim()||undefined,metaDescription=String(publication.metaDescription??metadata.metaDescription??"").trim()||undefined,html=typeof publication.html==="string"&&publication.html.trim()?publication.html:undefined,providerResourceId=typeof publication.providerResourceId==="string"?publication.providerResourceId:undefined;
  return{targetUrl,title,metaDescription,html,providerResourceId};
}
async function connectionForPackage(db:SupabaseClient,pkg:Record<string,unknown>){
  const result=await db.from("cms_connections").select("id,cms_type,site_url,status,last_verified_at,encrypted_secret_reference").eq("agency_id",pkg.agency_id).eq("project_id",pkg.project_id).eq("status","active").in("cms_type",["wordpress","shopify","webflow"]).order("last_verified_at",{ascending:false}).limit(1).maybeSingle();
  if(!result.data?.encrypted_secret_reference)throw new ApiError("Connect and verify WordPress, Shopify, or Webflow before publishing.",409,"WEBSITE_CONNECTION_FAILED");
  return result.data;
}
async function audit(db:SupabaseClient,pkg:Record<string,unknown>,actorId:string,action:string,publicationId:string,metadata:Record<string,unknown>){await db.from("audit_events").insert({agency_id:pkg.agency_id,actor_user_id:actorId,actor_type:"user",action,resource_type:"cms_publication",resource_id:publicationId,metadata});}

export async function publishCmsPackage(db:SupabaseClient,input:{packageId:string;agencyId:string;projectId:string;actorId:string;idempotencyKey:string}){
  const packageResult=await db.from("implementation_packages").select("*").eq("id",input.packageId).eq("agency_id",input.agencyId).eq("project_id",input.projectId).maybeSingle(),pkg=packageResult.data as Record<string,unknown>|null;
  if(!pkg)throw new ApiError("Implementation package not found.",404,"NOT_FOUND");
  if(pkg.status!=="client_approved")throw new ApiError("Client approval is required before CMS publishing.",409,"CONFLICT");
  if(!pkg.approval_digest||implementationPackageDigest(pkg)!==pkg.approval_digest)throw new ApiError("The implementation package changed after client approval. Publish stopped until the client approves the exact revision.",409,"INVALID_STATE");
  const existing=await db.from("cms_publications").select("id,status,provider_resource_id,target_url,updated_at").eq("agency_id",input.agencyId).eq("idempotency_key",input.idempotencyKey).maybeSingle();if(existing.data&&["published","rolled_back"].includes(existing.data.status))return existing.data;if(existing.data?.status==="publishing"||existing.data?.status==="reconciliation_required")throw new ApiError("This CMS write needs provider reconciliation before it can be retried safely.",409,"CONFLICT");
  const connection=await connectionForPackage(db,pkg),provider=connection.cms_type as Provider,secret=JSON.parse(decryptSecret(connection.encrypted_secret_reference)) as ConnectionSecret,payload=approvedPayload(pkg),context={provider,siteUrl:connection.site_url,secret,payload};
  const action:MutationAction={agencyId:input.agencyId,clientId:String(pkg.client_organization_id),projectId:input.projectId,toolKey:"cms.publish",resourceType:"implementation_package",resourceId:input.packageId,environment:"production",payload:{packageId:input.packageId,packageDigest:pkg.approval_digest,connectionId:connection.id,provider,targetUrl:payload.targetUrl}},intent=await requestMutationIntent(db,{action,summary:"Publish the exact client-approved CMS package.",riskLevel:"high",approvalPolicy:"client_package",requestedBy:input.actorId,idempotencyKey:`mutation:${input.idempotencyKey}`,expiresInMinutes:60});await claimStoredMutationIntent(db,{intentId:intent.id,agencyId:input.agencyId,projectId:input.projectId,toolKey:"cms.publish",expectedDigest:intent.action_digest,executionRef:input.idempotencyKey});
  let publicationId=existing.data?.id as string|undefined;
  if(!publicationId){const inserted=await db.from("cms_publications").insert({agency_id:pkg.agency_id,client_organization_id:pkg.client_organization_id,project_id:pkg.project_id,package_id:pkg.id,connection_id:connection.id,provider,provider_resource_type:"page",target_url:payload.targetUrl,status:"publishing",idempotency_key:input.idempotencyKey,published_by:input.actorId}).select("id").single();if(!inserted.data)throw new ApiError("The CMS publication ledger could not be created.",500,"DATABASE_BINDING_FAILED");publicationId=inserted.data.id;}
  else await db.from("cms_publications").update({status:"publishing",error_code:null,error_message:null,updated_at:new Date().toISOString()}).eq("id",publicationId);
  const ledgerId=publicationId;if(!ledgerId)throw new ApiError("The CMS publication ledger is unavailable.",500,"DATABASE_BINDING_FAILED");
  let providerWrite:ProviderWrite|null=null;
  try{
    providerWrite=provider==="wordpress"?await publishWordPress(context):provider==="shopify"?await publishShopify(context):await publishWebflow(context);const write=providerWrite,now=new Date().toISOString(),saved=await db.from("cms_publications").update({status:"published",provider_resource_type:write.resourceType,provider_resource_id:write.resourceId,before_snapshot:write.before,after_snapshot:write.after,provider_result:write.result,published_at:now,updated_at:now}).eq("id",ledgerId).select("id,status,provider,provider_resource_id,target_url,published_at").single();
    if(!saved.data)throw new ApiError("The provider write succeeded but its publication ledger could not be finalized.",500,"DATABASE_BINDING_FAILED");
    await settleMutationIntent(db,{intentId:intent.id,executionRef:input.idempotencyKey,status:"succeeded"});await db.from("implementation_packages").update({status:"implemented_unverified",implemented_at:now,updated_at:now}).eq("id",pkg.id);await db.from("implementation_verifications").upsert({agency_id:pkg.agency_id,client_organization_id:pkg.client_organization_id,project_id:pkg.project_id,package_id:pkg.id,live_url:payload.targetUrl,status:"pending",proof:{publicationId:ledgerId,provider,mutationIntentId:intent.id},checks:{},error_details:{}},{onConflict:"package_id"});await db.from("proof_of_work_events").insert({agency_id:pkg.agency_id,client_organization_id:pkg.client_organization_id,project_id:pkg.project_id,opportunity_id:pkg.opportunity_id,package_id:pkg.id,event_type:"cms_published",title:`${provider} change published`,description:"The approved package was published through the verified provider connection and is awaiting live QA.",client_visible:true,actor_user_id:input.actorId,metadata:{publicationId:ledgerId,provider,resourceId:write.resourceId,mutationIntentId:intent.id,actionDigest:intent.action_digest}});await audit(db,pkg,input.actorId,"cms.publication.published",ledgerId,{provider,packageId:pkg.id,projectId:pkg.project_id,mutationIntentId:intent.id,actionDigest:intent.action_digest});return saved.data;
  }catch(error){const code=error instanceof ApiError?error.code:"OPERATION_FAILED",status=providerWrite?"reconciliation_required":"publish_failed";await db.from("cms_publications").update({status,error_code:code,error_message:error instanceof ApiError?error.message:"Provider publishing failed.",provider_result:providerWrite?.result??{},updated_at:new Date().toISOString()}).eq("id",ledgerId);await settleMutationIntent(db,{intentId:intent.id,executionRef:input.idempotencyKey,status:"failed",errorCode:code,errorMessage:error instanceof Error?error.message:"Provider publishing failed."}).catch(()=>undefined);logServerError("cms_publish_failed",error,{agencyId:input.agencyId,projectId:input.projectId,provider,operation:"publish"});throw error;}
}

export async function rollbackCmsPublication(db:SupabaseClient,input:{publicationId:string;agencyId:string;projectId:string;actorId:string}){
  const result=await db.from("cms_publications").select("*").eq("id",input.publicationId).eq("agency_id",input.agencyId).eq("project_id",input.projectId).maybeSingle(),publication=result.data as Record<string,unknown>|null;if(!publication)throw new ApiError("CMS publication not found.",404,"NOT_FOUND");if(publication.status==="rolled_back")return publication;if(publication.status!=="published")throw new ApiError("Only a completed CMS publication can be rolled back.",409,"CONFLICT");
  const newer=await db.from("cms_publications").select("id").eq("connection_id",publication.connection_id).eq("provider_resource_id",publication.provider_resource_id).eq("status","published").gt("created_at",publication.created_at).limit(1);if(newer.data?.length)throw new ApiError("A newer publication exists for this page. Roll it back first to avoid overwriting later work.",409,"CONFLICT");
  const connection=await db.from("cms_connections").select("cms_type,site_url,status,encrypted_secret_reference").eq("id",publication.connection_id).eq("agency_id",input.agencyId).maybeSingle();if(!connection.data?.encrypted_secret_reference||connection.data.status!=="active")throw new ApiError("Reconnect and verify the CMS before rollback.",409,"WEBSITE_CONNECTION_FAILED");
  const provider=connection.data.cms_type as Provider,before=publication.before_snapshot as Record<string,unknown>,expectedAfter=publication.after_snapshot as Record<string,unknown>,executionRef=`cms-rollback:${input.publicationId}`,action:MutationAction={agencyId:input.agencyId,clientId:String(publication.client_organization_id),projectId:input.projectId,toolKey:"cms.rollback",resourceType:"cms_publication",resourceId:input.publicationId,environment:"production",payload:{publicationId:input.publicationId,packageId:publication.package_id,connectionId:publication.connection_id,provider,providerResourceId:publication.provider_resource_id,beforeDigest:actionDigest(before),expectedAfterDigest:actionDigest(expectedAfter)}},intent=await requestMutationIntent(db,{action,summary:`Restore the ${provider} page to its exact verified pre-publication state.`,riskLevel:"critical",approvalPolicy:"human",requestedBy:input.actorId,idempotencyKey:`mutation:${executionRef}:${actionDigest(expectedAfter)}`,expiresInMinutes:60});
  if(intent.status==="awaiting")throw new ApiError("Exact CMS rollback approval is now waiting in the Agent Workspace. Approve it, then click rollback again.",409,"APPROVAL_REQUIRED");
  await claimStoredMutationIntent(db,{intentId:intent.id,agencyId:input.agencyId,projectId:input.projectId,toolKey:"cms.rollback",expectedDigest:intent.action_digest,executionRef});
  const secret=JSON.parse(decryptSecret(connection.data.encrypted_secret_reference)) as ConnectionSecret,context:ProviderContext={provider,siteUrl:connection.data.site_url,secret,payload:{targetUrl:String(publication.target_url),providerResourceId:String(publication.provider_resource_id)}};await db.from("cms_publications").update({status:"rolling_back",updated_at:new Date().toISOString()}).eq("id",input.publicationId);
  let providerWrite:ProviderWrite|null=null;
  try{providerWrite=provider==="wordpress"?await rollbackWordPress(context,String(publication.provider_resource_id),before,expectedAfter):provider==="shopify"?await rollbackShopify(context,String(publication.provider_resource_id),before,expectedAfter):await rollbackWebflow(context,String(publication.provider_resource_id),before,expectedAfter);const write=providerWrite,now=new Date().toISOString(),saved=await db.from("cms_publications").update({status:"rolled_back",provider_result:{...((publication.provider_result&&typeof publication.provider_result==="object")?publication.provider_result:{}),rollback:write.result,rollbackMutationIntentId:intent.id},rolled_back_by:input.actorId,rolled_back_at:now,updated_at:now}).eq("id",input.publicationId).select("id,status,provider,target_url,rolled_back_at").single();if(!saved.data)throw new ApiError("Rollback succeeded but its ledger could not be finalized.",500,"DATABASE_BINDING_FAILED");await settleMutationIntent(db,{intentId:intent.id,executionRef,status:"succeeded"});const pkg={agency_id:publication.agency_id,project_id:publication.project_id};await audit(db,pkg,input.actorId,"cms.publication.rolled_back",input.publicationId,{provider,packageId:publication.package_id,projectId:publication.project_id,mutationIntentId:intent.id,actionDigest:intent.action_digest});return saved.data;}catch(error){const code=error instanceof ApiError?error.code:"OPERATION_FAILED",status=providerWrite?"reconciliation_required":"rollback_failed";await db.from("cms_publications").update({status,error_code:code,error_message:error instanceof ApiError?error.message:"Provider rollback failed.",updated_at:new Date().toISOString()}).eq("id",input.publicationId);if(!providerWrite)await settleMutationIntent(db,{intentId:intent.id,executionRef,status:"failed",errorCode:code,errorMessage:error instanceof Error?error.message:"Provider rollback failed."}).catch(()=>undefined);logServerError("cms_rollback_failed",error,{agencyId:input.agencyId,projectId:input.projectId,provider,operation:"rollback"});throw error;}
}
