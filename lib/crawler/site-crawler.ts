import "server-only";

import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { assertPublicSiteUrl } from "@/lib/websites/url-security";

const MAX_RESPONSE_BYTES=2_000_000;
const MAX_REDIRECTS=5;
const USER_AGENT="HDSEOEvidenceBot/1.0 (+https://hdseo.vercel.app)";

export type CrawledPage={url:string;finalUrl:string;httpStatus:number;title:string|null;metaDescription:string|null;h1:string|null;headings:string[];canonical:string|null;robotsDirectives:string[];schemaTypes:string[];schemaBlockCount:number;schemaJsonLdValid:boolean;internalLinks:string[];sitemapMember:boolean;indexable:boolean;contentHash:string;responseBytes:number;depth:number};

function decode(value:string){return value.replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\s+/g," ").trim();}
function stripTags(value:string){return decode(value.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," "));}
function attribute(tag:string,name:string){const match=tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,"i"));return decode(match?.[1]??match?.[2]??match?.[3]??"")||null;}
function metaContent(html:string,name:string){for(const tag of html.match(/<meta\b[^>]*>/gi)??[]){const key=(attribute(tag,"name")??attribute(tag,"property")??"").toLowerCase();if(key===name.toLowerCase())return attribute(tag,"content");}return null;}
function firstText(html:string,tag:string){const match=html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"));return match?stripTags(match[1])||null:null;}
function allText(html:string,tags:string){return[...html.matchAll(new RegExp(`<(?:${tags})\\b[^>]*>([\\s\\S]*?)<\\/(?:h[1-6])>`,"gi"))].map(match=>stripTags(match[1])).filter(Boolean).slice(0,200);}
function normalizedPageUrl(value:string){const url=new URL(value);url.hash="";if(url.protocol!=="https:"&&url.protocol!=="http:")return null;if(url.username||url.password)return null;url.searchParams.sort();return url.toString().replace(/\/$/,"");}
function sameSite(value:string,canonicalDomain:string){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,"")===canonicalDomain;}catch{return false;}}

async function limitedBody(response:Response){
  const declared=Number(response.headers.get("content-length")??0);if(declared>MAX_RESPONSE_BYTES)throw new ApiError("A website response exceeded the 2 MB crawl limit.",413,"CRAWL_FAILED");
  if(!response.body)return{body:"",bytes:0};
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_RESPONSE_BYTES){await reader.cancel();throw new ApiError("A website response exceeded the 2 MB crawl limit.",413,"CRAWL_FAILED");}chunks.push(part.value);}
  const merged=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}
  return{body:new TextDecoder("utf-8",{fatal:false}).decode(merged),bytes};
}

async function safeFetch(value:string,accept:string){
  let current=value;
  for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
    await assertPublicSiteUrl(current);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
    let response:Response;
    try{response=await fetch(current,{headers:{accept,"user-agent":USER_AGENT},redirect:"manual",cache:"no-store",signal:controller.signal});}
    catch{throw new ApiError("The website did not respond within the crawl safety limit.",503,"CRAWL_FAILED");}
    finally{clearTimeout(timer);}
    if(response.status>=300&&response.status<400){const location=response.headers.get("location");if(!location)throw new ApiError("The website returned an invalid redirect.",502,"CRAWL_FAILED");current=new URL(location,current).toString();continue;}
    const contentType=(response.headers.get("content-type")??"").toLowerCase(),content=await limitedBody(response);
    return{response,contentType,...content,finalUrl:current};
  }
  throw new ApiError("The website exceeded the five-redirect crawl limit.",508,"CRAWL_FAILED");
}

function robotsPolicy(value:string){
  const disallow:string[]=[];let relevant=false;
  for(const raw of value.split(/\r?\n/)){const line=raw.replace(/#.*/,"").trim(),separator=line.indexOf(":");if(separator<0)continue;const key=line.slice(0,separator).trim().toLowerCase(),entry=line.slice(separator+1).trim();if(key==="user-agent")relevant=entry==="*"||entry.toLowerCase().includes("hdseoevidencebot");else if(key==="disallow"&&relevant&&entry)disallow.push(entry);}
  return(pathname:string)=>!disallow.some(rule=>rule==="/"||pathname.startsWith(rule));
}

async function sitemapUrls(siteUrl:string,canonicalDomain:string,maxPages:number){
  const discovered=new Set<string>(),visitedMaps=new Set<string>(),pending=[`${siteUrl}/sitemap.xml`];
  while(pending.length&&visitedMaps.size<10&&discovered.size<maxPages){const sitemap=pending.shift()!;if(visitedMaps.has(sitemap)||!sameSite(sitemap,canonicalDomain))continue;visitedMaps.add(sitemap);let fetched;try{fetched=await safeFetch(sitemap,"application/xml,text/xml;q=0.9,*/*;q=0.1");}catch{continue;}if(!fetched.response.ok||!/(xml|text\/plain)/.test(fetched.contentType))continue;for(const match of fetched.body.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)){const location=decode(match[1]);if(!location||!sameSite(location,canonicalDomain))continue;if(/\.xml(?:\.gz)?(?:$|\?)/i.test(location)&&pending.length<20)pending.push(location);else{const normalized=normalizedPageUrl(location);if(normalized)discovered.add(normalized);}if(discovered.size>=maxPages)break;}}
  return discovered;
}

function parsePage(html:string,input:{requestedUrl:string;finalUrl:string;status:number;headers:Headers;bytes:number;depth:number;sitemapMember:boolean;robotsAllowed:boolean;canonicalDomain:string}){
  const title=firstText(html,"title"),metaDescription=metaContent(html,"description"),h1=firstText(html,"h1"),headings=allText(html,"h[1-6]");
  let canonical:string|null=null;for(const tag of html.match(/<link\b[^>]*>/gi)??[]){if((attribute(tag,"rel")??"").toLowerCase().split(/\s+/).includes("canonical")){const href=attribute(tag,"href");if(href)try{canonical=new URL(href,input.finalUrl).toString();}catch{}break;}}
  const directives=[...(metaContent(html,"robots")??"").split(","),...(input.headers.get("x-robots-tag")??"").split(",")].map(item=>item.trim().toLowerCase()).filter(Boolean);
  const schemaTypes=new Set<string>();let schemaJsonLdValid=true;for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const parsed=JSON.parse(match[1]);const nodes=Array.isArray(parsed)?parsed:Array.isArray(parsed?.["@graph"])?parsed["@graph"]:[parsed];for(const node of nodes){const value=node?.["@type"];for(const type of Array.isArray(value)?value:[value])if(typeof type==="string")schemaTypes.add(type);}}catch{schemaJsonLdValid=false;}}
  const internalLinks=new Set<string>();for(const tag of html.match(/<a\b[^>]*>/gi)??[]){const href=attribute(tag,"href");if(!href||/^(mailto:|tel:|javascript:|data:)/i.test(href))continue;try{const absolute=normalizedPageUrl(new URL(href,input.finalUrl).toString());if(absolute&&sameSite(absolute,input.canonicalDomain))internalLinks.add(absolute);}catch{}}
  const blocked=directives.some(item=>/^(noindex|none)$/.test(item));
  return{url:input.requestedUrl,finalUrl:input.finalUrl,httpStatus:input.status,title,metaDescription,h1,headings,canonical,robotsDirectives:directives,schemaTypes:[...schemaTypes],schemaBlockCount:(html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/gi)??[]).length,schemaJsonLdValid,internalLinks:[...internalLinks],sitemapMember:input.sitemapMember,indexable:input.status>=200&&input.status<300&&!blocked&&input.robotsAllowed,contentHash:createHash("sha256").update(html).digest("hex"),responseBytes:input.bytes,depth:input.depth} satisfies CrawledPage;
}

export async function inspectPublicPage(value:string):Promise<CrawledPage>{
  const normalized=await assertPublicSiteUrl(value),requested=normalizedPageUrl(normalized.siteUrl);
  if(!requested)throw new ApiError("The implementation URL is invalid.",400,"VALIDATION_ERROR");
  const root=new URL(requested);root.pathname="";root.search="";root.hash="";
  let robotsAllowed=true;
  try{const robots=await safeFetch(new URL("/robots.txt",root).toString(),"text/plain,*/*;q=0.1");if(robots.response.ok)robotsAllowed=robotsPolicy(robots.body)(new URL(requested).pathname);}catch{/* a missing robots file does not block direct verification */}
  const fetched=await safeFetch(requested,"text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
  if(!fetched.contentType.includes("text/html")&&!fetched.contentType.includes("application/xhtml+xml"))throw new ApiError("The implementation URL did not return an HTML page.",409,"WEBSITE_VERIFICATION_FAILED");
  return parsePage(fetched.body,{requestedUrl:requested,finalUrl:fetched.finalUrl,status:fetched.response.status,headers:fetched.response.headers,bytes:fetched.bytes,depth:0,sitemapMember:false,robotsAllowed,canonicalDomain:normalized.canonicalDomain});
}

export async function crawlSite(input:{siteUrl:string;maxPages:number}){
  const normalized=await assertPublicSiteUrl(input.siteUrl),maxPages=Math.max(1,Math.min(input.maxPages,10_000));
  let allowed:(pathname:string)=>boolean=()=>true;try{const robots=await safeFetch(`${normalized.siteUrl}/robots.txt`,"text/plain,*/*;q=0.1");if(robots.response.ok)allowed=robotsPolicy(robots.body);}catch{/* absent robots is not a crawl failure */}
  const sitemap=await sitemapUrls(normalized.siteUrl,normalized.canonicalDomain,maxPages),queue:Array<{url:string;depth:number}>=[{url:normalized.siteUrl,depth:0},...[...sitemap].map(url=>({url,depth:0}))],queued=new Set(queue.map(item=>item.url)),visited=new Set<string>(),pages:CrawledPage[]=[];
  while(queue.length&&pages.length<maxPages){const next=queue.shift()!,requested=normalizedPageUrl(next.url);if(!requested||visited.has(requested)||!sameSite(requested,normalized.canonicalDomain))continue;visited.add(requested);const path=new URL(requested).pathname,robotsAllowed=allowed(path);if(!robotsAllowed)continue;let fetched;try{fetched=await safeFetch(requested,"text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");}catch(error){if(pages.length===0&&requested===normalized.siteUrl)throw error;continue;}if(!fetched.contentType.includes("text/html")&&!fetched.contentType.includes("application/xhtml+xml"))continue;const page=parsePage(fetched.body,{requestedUrl:requested,finalUrl:fetched.finalUrl,status:fetched.response.status,headers:fetched.response.headers,bytes:fetched.bytes,depth:next.depth,sitemapMember:sitemap.has(requested),robotsAllowed,canonicalDomain:normalized.canonicalDomain});pages.push(page);if(next.depth<10)for(const link of page.internalLinks){if(!visited.has(link)&&!queued.has(link)&&queue.length<maxPages*3){queued.add(link);queue.push({url:link,depth:next.depth+1});}}}
  if(!pages.length)throw new ApiError("The crawler could not collect any HTML pages from this website.",502,"CRAWL_FAILED");
  return{pages,sitemapUrls:[...sitemap],siteUrl:normalized.siteUrl,canonicalDomain:normalized.canonicalDomain};
}
