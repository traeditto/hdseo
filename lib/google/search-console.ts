import "server-only";

import { ApiError } from "@/lib/api/errors";
import { env,googleCallbackUrl,hasGoogleSearchConsoleConfig } from "@/lib/config/env";
export { propertyMatchesDomain } from "./property";

const GOOGLE_OAUTH="https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN="https://oauth2.googleapis.com/token";
const WEBMASTERS="https://www.googleapis.com/webmasters/v3";
const INSPECTION="https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
export const GOOGLE_SCOPES=["https://www.googleapis.com/auth/webmasters.readonly","openid","email"];

export type GoogleCredentials={refreshToken:string;accessToken:string;expiresAt:number;scope:string;tokenType:string};
export type SearchConsoleProperty={siteUrl:string;permissionLevel:string};
export type SearchAnalyticsRow={keys?:string[];clicks?:number;impressions?:number;ctr?:number;position?:number};

function requireConfig(){if(!hasGoogleSearchConsoleConfig)throw new ApiError("Google Search Console OAuth is not configured.",503,"NOT_CONFIGURED");}

export function googleAuthorizationUrl(state:string,options?:{scopes?:string[];redirectUri?:string}){
  requireConfig();
  const url=new URL(GOOGLE_OAUTH);
  url.searchParams.set("client_id",env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri",options?.redirectUri??googleCallbackUrl());
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope",(options?.scopes??GOOGLE_SCOPES).join(" "));
  url.searchParams.set("access_type","offline");
  url.searchParams.set("prompt","consent");
  url.searchParams.set("include_granted_scopes","true");
  url.searchParams.set("state",state);
  return url.toString();
}

async function parsedResponse<T>(response:Response,code:"GOOGLE_OAUTH_FAILED"|"GOOGLE_API_FAILED"){
  const body=await response.json().catch(()=>null) as T&{error?:unknown;error_description?:string}|null;
  if(!response.ok){
    if(response.status===429)throw new ApiError("Google quota is temporarily limited. HD SEO will retry automatically after the quota window clears.",503,"RATE_LIMITED");
    const retryable=response.status===429||response.status>=500;
    throw new ApiError(retryable?"Google is temporarily unavailable. The evidence job will retry.":code==="GOOGLE_OAUTH_FAILED"?"Google authorization could not be completed.":"Google Search Console rejected the request.",retryable?503:response.status===401?401:502,code);
  }
  if(!body)throw new ApiError("Google returned an unreadable response.",502,code);
  return body;
}

async function tokenRequest(parameters:URLSearchParams){
  requireConfig();
  parameters.set("client_id",env.GOOGLE_CLIENT_ID!);
  parameters.set("client_secret",env.GOOGLE_CLIENT_SECRET!);
  const response=await fetch(GOOGLE_TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",accept:"application/json"},body:parameters,cache:"no-store"});
  return parsedResponse<{access_token:string;expires_in:number;refresh_token?:string;scope?:string;token_type?:string}>(response,"GOOGLE_OAUTH_FAILED");
}

export async function exchangeGoogleCode(code:string,redirectUri=googleCallbackUrl()):Promise<GoogleCredentials>{
  const token=await tokenRequest(new URLSearchParams({code,redirect_uri:redirectUri,grant_type:"authorization_code"}));
  if(!token.access_token)throw new ApiError("Google did not return an access token.",502,"GOOGLE_OAUTH_FAILED");
  return{accessToken:token.access_token,refreshToken:token.refresh_token??"",expiresAt:Date.now()+Math.max(60,token.expires_in??3600)*1000,scope:token.scope??GOOGLE_SCOPES.join(" "),tokenType:token.token_type??"Bearer"};
}

export async function refreshGoogleCredentials(credentials:GoogleCredentials):Promise<GoogleCredentials>{
  if(credentials.expiresAt>Date.now()+60_000)return credentials;
  if(!credentials.refreshToken)throw new ApiError("Reconnect Search Console to renew access.",401,"SEARCH_CONSOLE_NOT_CONNECTED");
  const token=await tokenRequest(new URLSearchParams({refresh_token:credentials.refreshToken,grant_type:"refresh_token"}));
  return{...credentials,accessToken:token.access_token,expiresAt:Date.now()+Math.max(60,token.expires_in??3600)*1000,scope:token.scope??credentials.scope,tokenType:token.token_type??credentials.tokenType};
}

export async function googleFetch<T>(url:string,accessToken:string,init:RequestInit={}){
  for(let attempt=0;attempt<3;attempt++){
    let response:Response;
    try{response=await fetch(url,{...init,headers:{accept:"application/json",authorization:`Bearer ${accessToken}`,...init.headers},cache:"no-store"});}
    catch{if(attempt<2)continue;throw new ApiError("Google Search Console could not be reached.",503,"GOOGLE_API_FAILED");}
    if(response.status>=500&&attempt<2)continue;
    return parsedResponse<T>(response,"GOOGLE_API_FAILED");
  }
  throw new ApiError("Google Search Console could not be reached.",503,"GOOGLE_API_FAILED");
}

export async function listSearchConsoleProperties(accessToken:string){
  const result=await googleFetch<{siteEntry?:Array<{siteUrl?:string;permissionLevel?:string}>}>(`${WEBMASTERS}/sites`,accessToken);
  return(result.siteEntry??[]).flatMap(item=>item.siteUrl?[{siteUrl:item.siteUrl,permissionLevel:item.permissionLevel??"unknown"}]:[]) as SearchConsoleProperty[];
}

export async function googleAccountEmail(accessToken:string){
  const result=await googleFetch<{email?:string}>("https://openidconnect.googleapis.com/v1/userinfo",accessToken);
  return result.email??null;
}

export async function querySearchAnalytics(input:{accessToken:string;property:string;startDate:string;endDate:string;startRow?:number;rowLimit?:number}){
  return googleFetch<{rows?:SearchAnalyticsRow[]}>(`${WEBMASTERS}/sites/${encodeURIComponent(input.property)}/searchAnalytics/query`,input.accessToken,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({startDate:input.startDate,endDate:input.endDate,dimensions:["query","page","date","device","country"],dataState:"final",rowLimit:Math.min(25_000,input.rowLimit??25_000),startRow:input.startRow??0})});
}

export async function listSearchConsoleSitemaps(accessToken:string,property:string){
  return googleFetch<{sitemap?:Array<Record<string,unknown>>}>(`${WEBMASTERS}/sites/${encodeURIComponent(property)}/sitemaps`,accessToken);
}

export async function inspectSearchConsoleUrl(accessToken:string,property:string,inspectionUrl:string){
  return googleFetch<{inspectionResult?:Record<string,unknown>}>(INSPECTION,accessToken,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inspectionUrl,siteUrl:property,languageCode:"en-US"})});
}
