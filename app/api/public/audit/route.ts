import{createHash}from"node:crypto";
import{z}from"zod";
import{ApiError,jsonError}from"@/lib/api/errors";
import{parseJson}from"@/lib/api/request";
import{enforceRateLimit}from"@/lib/automation/control-plane";
import{crawlSite}from"@/lib/crawler/site-crawler";
import{publicAuditReport}from"@/lib/growth/core";

const schema=z.object({website:z.string().trim().min(4).max(1000),service:z.string().trim().max(160).optional(),serviceArea:z.string().trim().max(160).optional()});
export async function POST(request:Request){try{const input=await parseJson(request,schema),forwarded=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown",key=createHash("sha256").update(`${forwarded}:${request.headers.get("user-agent")??""}`).digest("hex");await enforceRateLimit(`public-audit:${key}`,"crawl",3,86400);let website=input.website;if(!/^https?:\/\//i.test(website))website=`https://${website}`;const crawl=await crawlSite({siteUrl:website,maxPages:25}),report=publicAuditReport(crawl.pages,input);return Response.json({ok:true,website:crawl.siteUrl,report})}catch(error){if(error instanceof ApiError)return jsonError(error);return jsonError(new ApiError("The public audit could not be completed.",500,"AUDIT_FAILED"))}}
