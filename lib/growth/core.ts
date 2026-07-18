export type AuditPage={url:string;title?:string|null;metaDescription?:string|null;h1?:string|null;indexable?:boolean;schemaTypes?:string[];internalLinks?:string[]};

const riskyAuthority=/\b(link\s*exchange|reciprocal\s+link|paid\s+dofollow|buy\s+(?:a\s+)?link|private\s+blog\s+network|\bpbn\b)\b/i;

export function normalizeBuyerQuestion(value:string){return value.trim().toLowerCase().replace(/\s+/g," ").replace(/[?.!]+$/g,"")}
export function phaseForSequence(sequence:number){return sequence<=5?30:sequence<=12?60:90}
export function isSafeAuthorityOpportunity(...values:Array<string|undefined|null>){return!riskyAuthority.test(values.filter(Boolean).join(" "))}

function tokens(value:string){return new Set(value.toLowerCase().replace(/^https?:\/\//,"").replace(/[^a-z0-9]+/g," ").split(" ").filter(word=>word.length>3))}
export function semanticOverlap(left:string,right:string){const a=tokens(left),b=tokens(right);if(!a.size||!b.size)return 0;let common=0;for(const token of a)if(b.has(token))common++;return Math.round(common/Math.max(a.size,b.size)*100)}

export function publicAuditReport(pages:AuditPage[],context:{service?:string;serviceArea?:string}={}){
  const findings:Array<{code:string;severity:"high"|"medium"|"low";title:string;detail:string;urls:string[]}>=[];
  const add=(code:string,severity:"high"|"medium"|"low",title:string,detail:string,urls:string[])=>{if(urls.length)findings.push({code,severity,title,detail,urls:urls.slice(0,10)})};
  add("NOT_INDEXABLE","high","Pages are blocked from indexing","Search engines cannot rank pages that are noindex or otherwise non-indexable.",pages.filter(page=>page.indexable===false).map(page=>page.url));
  add("MISSING_TITLE","high","Pages need unique titles","Missing titles make page purpose and search relevance harder to understand.",pages.filter(page=>!page.title?.trim()).map(page=>page.url));
  add("MISSING_H1","medium","Pages need a clear main heading","A descriptive H1 helps visitors and search engines understand the primary job of the page.",pages.filter(page=>!page.h1?.trim()).map(page=>page.url));
  add("MISSING_META","medium","Search snippets need improvement","Missing meta descriptions reduce control over how pages are presented in search.",pages.filter(page=>!page.metaDescription?.trim()).map(page=>page.url));
  add("NO_SCHEMA","low","Structured data coverage is limited","Relevant, valid schema can make business and service facts easier for search systems to interpret.",pages.filter(page=>!(page.schemaTypes?.length)).map(page=>page.url));
  const inbound=new Map<string,number>();for(const page of pages)for(const link of page.internalLinks??[])inbound.set(link,(inbound.get(link)??0)+1);
  add("ORPHANED_PAGE","medium","Important pages may lack internal links","Contextual internal links help people and crawlers discover useful pages.",pages.slice(1).filter(page=>!inbound.get(page.url)).map(page=>page.url));
  const deduction=findings.reduce((sum,item)=>sum+(item.severity==="high"?15:item.severity==="medium"?8:3)*Math.min(item.urls.length,3),0),score=Math.max(0,Math.min(100,100-deduction));
  const market=[context.service,context.serviceArea].filter(Boolean).join(" in ");
  return{score,pagesAnalyzed:pages.length,context:market||null,findings:findings.sort((a,b)=>({high:3,medium:2,low:1}[b.severity]-{high:3,medium:2,low:1}[a.severity])),nextStep:findings.length?"Connect the site to build an evidence-backed, approval-gated implementation plan.":"No basic blockers were found. Connect Search Console to prioritize work by local demand and business value.",limitations:["This crawl is a technical snapshot, not a ranking guarantee.","Keyword value requires verified service areas, Search Console evidence, and provider data."]};
}
