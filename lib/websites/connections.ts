import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/errors";
import { hasPermission,type AgencyRole } from "@/lib/auth/permissions";
import { getLiveAdminClient } from "@/lib/live/identity";
import { decryptSecret,encryptSecret } from "@/lib/security/encryption";
import { assertPublicSiteUrl,normalizeSiteUrl } from "@/lib/websites/url-security";

export type WebsiteConnectionMode="wordpress"|"shopify"|"webflow"|"manual"|"monitoring"|"managed";
export type ConnectWebsiteInput={projectId:string;mode:WebsiteConnectionMode;siteUrl:string;portal?:"agency"|"client";username?:string;applicationPassword?:string;accessToken?:string;siteId?:string;platformName?:string;notes?:string};
type ConnectionSecret={version:1;provider:"wordpress"|"shopify"|"webflow";username?:string;applicationPassword?:string;accessToken?:string;siteId?:string;shop?:string};

async function connectionContext(email:string,projectId?:string,websiteId?:string,preferredPortal?:"agency"|"client"){
  const db=getLiveAdminClient(),profile=await db.from("profiles").select("id").ilike("email",email.toLowerCase()).maybeSingle();
  if(!profile.data?.id)throw new ApiError("Sign in before connecting a website.",401,"AUTH_REQUIRED");

  let resolvedProjectId=projectId;
  if(websiteId){
    const website=await db.from("websites").select("project_id").eq("id",websiteId).maybeSingle();
    if(!website.data)throw new ApiError("Website connection not found.",404,"NOT_FOUND");
    resolvedProjectId=website.data.project_id;
  }
  if(!resolvedProjectId)throw new ApiError("Choose a business website first.",400,"VALIDATION_ERROR");

  const projectResult=await db.from("seo_projects").select("id,name,domain,agency_id,client_organization_id").eq("id",resolvedProjectId).eq("status","active").maybeSingle();
  const project=projectResult.data;
  if(!project)throw new ApiError("Client project not found.",404,"NOT_FOUND");

  const [agencyMembership,clientMembership]=await Promise.all([
    db.from("agency_members").select("role").eq("user_id",profile.data.id).eq("agency_id",project.agency_id).eq("status","active").maybeSingle(),
    db.from("client_members").select("role").eq("user_id",profile.data.id).eq("client_organization_id",project.client_organization_id).eq("status","active").maybeSingle(),
  ]);
  const agencyAllowed=agencyMembership.data&&hasPermission(agencyMembership.data.role as AgencyRole,"integrations.manage");
  const clientAllowed=clientMembership.data?.role==="client_admin";
  if(!agencyAllowed&&!clientAllowed)throw new ApiError("Only an agency connection manager or the business owner can connect this website.",403,"ROLE_FORBIDDEN");
  const portal=preferredPortal==="client"&&clientAllowed?"client" as const:agencyAllowed?"agency" as const:"client" as const;
  return{db,userId:profile.data.id,agencyId:project.agency_id,project,portal};
}

async function providerFetch(url:string,init:RequestInit){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
  try{return await fetch(url,{...init,signal:controller.signal,redirect:"error",cache:"no-store"});}
  catch(error){if(error instanceof ApiError)throw error;throw new ApiError("The website provider could not be reached.",502,"WEBSITE_VERIFICATION_FAILED");}
  finally{clearTimeout(timer);}
}

async function verifyWordPress(siteUrl:string,secret:ConnectionSecret){
  if(!secret.username||!secret.applicationPassword)throw new ApiError("WordPress username and application password are required.",400,"VALIDATION_ERROR");
  const normalized=await assertPublicSiteUrl(siteUrl),endpoint=`${normalized.siteUrl}/wp-json/wp/v2/users/me?context=edit`,authorization=Buffer.from(`${secret.username}:${secret.applicationPassword.replace(/\s+/g,"")}`).toString("base64"),response=await providerFetch(endpoint,{headers:{Accept:"application/json",Authorization:`Basic ${authorization}`}});
  if(response.status===401||response.status===403)throw new ApiError("WordPress rejected the application password or the user lacks editing permission.",401,"WEBSITE_VERIFICATION_FAILED");
  if(!response.ok)throw new ApiError(`WordPress verification failed with HTTP ${response.status}.`,502,"WEBSITE_VERIFICATION_FAILED");
  const user=await response.json() as {id?:number;name?:string;roles?:string[];capabilities?:Record<string,boolean>};
  if(!user.id||!(user.capabilities?.edit_posts??user.roles?.some(role=>["administrator","editor","author"].includes(role))))throw new ApiError("The WordPress user cannot edit website content.",403,"WEBSITE_VERIFICATION_FAILED");
  return{...normalized,editorMode:user.capabilities?.publish_posts?"wordpress_rest_publish":"wordpress_rest_edit",accountId:String(user.id)};
}

function shopifyUrl(value:string){
  const raw=value.trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,""),host=raw.includes(".")?raw:`${raw}.myshopify.com`;
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host))throw new ApiError("Enter the permanent myshopify.com store domain.",400,"VALIDATION_ERROR");
  return`https://${host}`;
}

async function verifyShopify(siteUrl:string,secret:ConnectionSecret){
  if(!secret.accessToken)throw new ApiError("A Shopify Admin API access token is required.",400,"VALIDATION_ERROR");
  const base=shopifyUrl(secret.shop??siteUrl),response=await providerFetch(`${base}/admin/api/2026-07/graphql.json`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json","X-Shopify-Access-Token":secret.accessToken},body:JSON.stringify({query:"query HDSEOConnection { shop { id name myshopifyDomain primaryDomain { url } } }"})});
  if(response.status===401||response.status===403)throw new ApiError("Shopify rejected the access token or required content permissions are missing.",401,"WEBSITE_VERIFICATION_FAILED");
  const result=await response.json().catch(()=>null) as {data?:{shop?:{id?:string;myshopifyDomain?:string;primaryDomain?:{url?:string}}};errors?:unknown[]}|null;
  if(!response.ok||result?.errors?.length||!result?.data?.shop?.id)throw new ApiError("Shopify could not verify this store connection.",502,"WEBSITE_VERIFICATION_FAILED");
  const primary=result.data.shop.primaryDomain?.url??base,normalized=normalizeSiteUrl(primary);
  return{...normalized,editorMode:"shopify_admin_content",accountId:result.data.shop.id,providerSiteUrl:base};
}

async function verifyWebflow(siteUrl:string,secret:ConnectionSecret){
  if(!secret.accessToken||!secret.siteId)throw new ApiError("A Webflow site ID and access token are required.",400,"VALIDATION_ERROR");
  const response=await providerFetch(`https://api.webflow.com/v2/sites/${encodeURIComponent(secret.siteId)}`,{headers:{Accept:"application/json",Authorization:`Bearer ${secret.accessToken}`,"accept-version":"2.0.0"}});
  if(response.status===401||response.status===403)throw new ApiError("Webflow rejected the token or it cannot access this site.",401,"WEBSITE_VERIFICATION_FAILED");
  if(!response.ok)throw new ApiError(`Webflow verification failed with HTTP ${response.status}.`,502,"WEBSITE_VERIFICATION_FAILED");
  const site=await response.json() as {id?:string;shortName?:string;customDomains?:Array<{url?:string}>};if(!site.id||site.id!==secret.siteId)throw new ApiError("The Webflow site was not authorized.",403,"WEBSITE_VERIFICATION_FAILED");
  const normalized=await assertPublicSiteUrl(siteUrl);return{...normalized,editorMode:"webflow_data_api",accountId:site.id};
}

async function verifyDirect(mode:WebsiteConnectionMode,siteUrl:string,secret:ConnectionSecret){
  if(mode==="wordpress")return verifyWordPress(siteUrl,secret);
  if(mode==="shopify")return verifyShopify(siteUrl,secret);
  if(mode==="webflow")return verifyWebflow(siteUrl,secret);
  const normalized=await assertPublicSiteUrl(siteUrl);return{...normalized,editorMode:mode==="monitoring"?"read_only":mode==="managed"?"migration_review":"manual_handoff",accountId:null};
}

function modeValues(input:ConnectWebsiteInput){
  if(input.mode==="wordpress")return{cmsType:"wordpress",connectionMode:"api",status:"active",secret:{version:1,provider:"wordpress",username:input.username,applicationPassword:input.applicationPassword} as ConnectionSecret};
  if(input.mode==="shopify")return{cmsType:"shopify",connectionMode:"api",status:"active",secret:{version:1,provider:"shopify",accessToken:input.accessToken,shop:input.siteUrl} as ConnectionSecret};
  if(input.mode==="webflow")return{cmsType:"webflow",connectionMode:"api",status:"active",secret:{version:1,provider:"webflow",accessToken:input.accessToken,siteId:input.siteId} as ConnectionSecret};
  if(input.mode==="monitoring")return{cmsType:"unknown",connectionMode:"monitor_only",status:"active",secret:null};
  if(input.mode==="managed")return{cmsType:"managed",connectionMode:"managed_migration",status:"pending",secret:null};
  return{cmsType:(input.platformName||"generic").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"_").slice(0,50)||"generic",connectionMode:"manual",status:"manual",secret:null};
}

async function writeAudit(db:SupabaseClient,input:{agencyId:string;userId:string;action:string;resourceId:string;projectId:string;mode:string}){
  const result=await db.from("audit_events").insert({agency_id:input.agencyId,actor_user_id:input.userId,actor_type:"user",action:input.action,resource_type:"website",resource_id:input.resourceId,after_state:{projectId:input.projectId,connectionMode:input.mode},metadata:{source:"website_onboarding"}});
  if(result.error)throw new ApiError("The website connection audit record could not be stored.",500,"DATABASE_BINDING_FAILED");
}

export async function connectWebsite(email:string,input:ConnectWebsiteInput){
  const context=await connectionContext(email,input.projectId,undefined,input.portal),values=modeValues(input),verified=await verifyDirect(input.mode,input.siteUrl,values.secret??({version:1,provider:"wordpress"} as ConnectionSecret)),now=new Date().toISOString();
  const existing=await context.db.from("websites").select("cms_type,status,last_verified_at").eq("agency_id",context.agencyId).eq("project_id",context.project.id).eq("is_primary",true).limit(1).maybeSingle();
  const websiteCmsType=["wordpress","shopify","webflow"].includes(input.mode)?values.cmsType:(existing.data?.cms_type||values.cmsType);
  const websiteStatus=["pending","manual"].includes(values.status)?(existing.data?.status||"active"):values.status;
  const websiteVerifiedAt=["pending","manual"].includes(values.status)?(existing.data?.last_verified_at||now):now;
  const website=await context.db.from("websites").upsert({agency_id:context.agencyId,client_organization_id:context.project.client_organization_id,project_id:context.project.id,name:context.project.name,site_url:verified.siteUrl,canonical_domain:verified.canonicalDomain,cms_type:websiteCmsType,is_primary:true,status:websiteStatus,last_verified_at:websiteVerifiedAt,updated_at:now},{onConflict:"project_id,canonical_domain"}).select("id").single();
  if(website.error||!website.data)throw new ApiError("The website record could not be saved.",500,"DATABASE_BINDING_FAILED");
  const connection=await context.db.from("cms_connections").upsert({agency_id:context.agencyId,client_organization_id:context.project.client_organization_id,project_id:context.project.id,website_id:website.data.id,cms_type:values.cmsType,editor_mode:verified.editorMode,site_url:verified.siteUrl,connection_mode:values.connectionMode,status:values.status,encrypted_secret_reference:values.secret?encryptSecret(JSON.stringify(values.secret)):null,last_verified_at:values.status==="pending"?null:now,updated_at:now},{onConflict:"project_id,site_url"}).select("id").single();
  if(connection.error||!connection.data)throw new ApiError("The website connection could not be saved.",500,"DATABASE_BINDING_FAILED");
  await context.db.from("proof_of_work_events").insert({agency_id:context.agencyId,client_organization_id:context.project.client_organization_id,project_id:context.project.id,event_type:"website_connected",title:`${values.cmsType} website ${values.status==="pending"?"onboarding requested":"connected"}`,description:`${verified.siteUrl} uses the ${values.connectionMode.replaceAll("_"," ")} workflow.`,actor_user_id:context.userId,metadata:{website_id:website.data.id,connection_id:connection.data.id}});
  await writeAudit(context.db,{agencyId:context.agencyId,userId:context.userId,action:"website.connection.created",resourceId:website.data.id,projectId:context.project.id,mode:values.connectionMode});
  return{websiteId:website.data.id,status:values.status,cmsType:values.cmsType,portal:context.portal};
}

export async function testWebsiteConnection(email:string,websiteId:string){
  const context=await connectionContext(email,undefined,websiteId),website=await context.db.from("websites").select("id,site_url").eq("id",websiteId).eq("agency_id",context.agencyId).single(),connection=await context.db.from("cms_connections").select("id,cms_type,connection_mode,status,encrypted_secret_reference,site_url").eq("website_id",websiteId).eq("agency_id",context.agencyId).order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(!website.data||!connection.data)throw new ApiError("Website connection not found.",404,"NOT_FOUND");
  const mode=connection.data.cms_type as WebsiteConnectionMode;
  if(!["wordpress","shopify","webflow"].includes(mode)){await assertPublicSiteUrl(website.data.site_url);await context.db.from("websites").update({last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",websiteId);return{status:connection.data.status,message:"The public website is reachable.",portal:context.portal};}
  if(!connection.data.encrypted_secret_reference)throw new ApiError("Stored website credentials are unavailable. Reconnect the website.",409,"WEBSITE_CONNECTION_FAILED");
  const secret=JSON.parse(decryptSecret(connection.data.encrypted_secret_reference)) as ConnectionSecret;await verifyDirect(mode,connection.data.site_url,secret);const now=new Date().toISOString();
  await Promise.all([context.db.from("websites").update({status:"active",last_verified_at:now,updated_at:now}).eq("id",websiteId),context.db.from("cms_connections").update({status:"active",last_verified_at:now,updated_at:now}).eq("id",connection.data.id)]);
  return{status:"active",message:"Provider credentials and website access were verified.",portal:context.portal};
}

export async function disconnectWebsite(email:string,websiteId:string){
  const context=await connectionContext(email,undefined,websiteId),now=new Date().toISOString(),connection=await context.db.from("cms_connections").update({status:"disconnected",encrypted_secret_reference:null,updated_at:now}).eq("website_id",websiteId).eq("agency_id",context.agencyId);
  if(connection.error)throw new ApiError("The website connection could not be disconnected.",500,"DATABASE_BINDING_FAILED");
  await context.db.from("websites").update({status:"connection_required",updated_at:now}).eq("id",websiteId).eq("agency_id",context.agencyId);
  await writeAudit(context.db,{agencyId:context.agencyId,userId:context.userId,action:"website.connection.disconnected",resourceId:websiteId,projectId:context.project.id,mode:"disconnected"});
  return{portal:context.portal};
}

export async function upsertGitHubWebsite(input:{db:SupabaseClient;agencyId:string;clientId:string;projectId:string;projectName:string;domain:string}){
  const normalized=normalizeSiteUrl(input.domain),now=new Date().toISOString(),website=await input.db.from("websites").upsert({agency_id:input.agencyId,client_organization_id:input.clientId,project_id:input.projectId,name:input.projectName,site_url:normalized.siteUrl,canonical_domain:normalized.canonicalDomain,cms_type:"github",is_primary:true,status:"active",last_verified_at:now,updated_at:now},{onConflict:"project_id,canonical_domain"}).select("id").single();
  if(website.error||!website.data)throw new ApiError("The GitHub website record could not be saved.",500,"DATABASE_BINDING_FAILED");
  const connection=await input.db.from("cms_connections").upsert({agency_id:input.agencyId,client_organization_id:input.clientId,project_id:input.projectId,website_id:website.data.id,cms_type:"github",editor_mode:"repository",site_url:normalized.siteUrl,connection_mode:"github_app",status:"active",encrypted_secret_reference:null,last_verified_at:now,updated_at:now},{onConflict:"project_id,site_url"});
  if(connection.error)throw new ApiError("The GitHub website connection could not be saved.",500,"DATABASE_BINDING_FAILED");
  return website.data.id as string;
}
