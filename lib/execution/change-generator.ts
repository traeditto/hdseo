export type ApprovedCreative = {
  title: string;
  meta_description: string;
  h1: string;
  summary: string;
  sections: unknown;
  faqs: unknown;
  schema_markup: unknown;
};

export type RepositoryFile = {path:string;sha:string;content:string};

const titleCase=(value:string)=>value.split(/\s+/).filter(Boolean).map(word=>word.length<4?word.toLowerCase():word[0].toUpperCase()+word.slice(1).toLowerCase()).join(" ");
const text=(value:unknown)=>typeof value==="string"?value.trim():"";
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export const pageSlug=(targetUrl:string|null|undefined,keyword:string)=>{try{const path=targetUrl?new URL(targetUrl,"https://placeholder.invalid").pathname:"";if(path&&path!=="/")return path.replace(/^\/+|\/+$/g,"").replace(/[^a-z0-9/_-]/gi,"-").toLowerCase();}catch{}return keyword.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"seo-opportunity";};

function metadataCandidate(keyword:string,creative?:ApprovedCreative|null){return{title:(creative?.title||titleCase(keyword)).slice(0,65),description:(creative?.meta_description||`Learn what matters when evaluating ${keyword}, with clear next steps based on the services available in your market.`).slice(0,170),h1:creative?.h1||titleCase(keyword)};}

const pageModule=/(?:^|\/)(?:page|index)\.(?:ts|tsx|js|jsx|mjs|html)$/i;
const contentModule=/(?:^|\/)(?:content|site-data|page-data|pages-data|seo-data|seo-content)(?:\.|\/)/i;
const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

function objectRange(source:string,open:number){let depth=0,quote="",escapedCharacter=false;for(let index=open;index<source.length;index+=1){const character=source[index];if(quote){if(escapedCharacter)escapedCharacter=false;else if(character==="\\")escapedCharacter=true;else if(character===quote)quote="";continue}if(character==='"'||character==="'"||character==='`'){quote=character;continue}if(character==="{")depth+=1;else if(character==="}"&&--depth===0)return{start:open,end:index+1}}return null;}

function proposeStructuredRecordChange(file:RepositoryFile,slug:string,keyword:string,creative:ApprovedCreative){
  if(!contentModule.test(file.path))return null;
  const key=new RegExp(`(?:^|\\n)\\s*(?:["']${escaped(slug)}["']|${escaped(slug)})\\s*:\\s*\\{`,`m`).exec(file.content),open=key?file.content.indexOf("{",key.index):-1,range=open>=0?objectRange(file.content,open):null;
  if(!range)return null;
  const record=file.content.slice(range.start,range.end),candidate=metadataCandidate(keyword,creative);
  let changed=record;const fields:string[]=[];
  const replacements:Array<[RegExp,string,string]>=[[/\bseoTitle\s*:\s*["'][^"']*["']/,`seoTitle: ${JSON.stringify(candidate.title)}`,"SEO title"],[/\bprimaryKeyword\s*:\s*["'][^"']*["']/,`primaryKeyword: ${JSON.stringify(keyword)}`,"primary keyword"]];
  for(const [pattern,replacement,label] of replacements){if(!pattern.test(changed))continue;changed=changed.replace(pattern,replacement);fields.push(label)}
  if(!fields.length||changed===record)return null;
  const proposed=file.content.slice(0,range.start)+changed+file.content.slice(range.end);
  return{filePath:file.path,originalSha:file.sha,originalContent:file.content,proposedContent:proposed,diff:`--- a/${file.path}\n+++ b/${file.path}\n@@ ${slug} SEO record @@\n- Existing ${fields.join(", ")}\n+ ${candidate.title} | ${keyword}`,reason:`Update only the ${slug} page's ${fields.join(" and ")} from the approved creative and verified query evidence.`};
}

export function proposeMetadataChange(file:RepositoryFile,keyword:string,creative?:ApprovedCreative|null,targetSlug?:string){
  if(!creative)return null;
  if(targetSlug){const structured=proposeStructuredRecordChange(file,targetSlug,keyword,creative);if(structured)return structured;}
  if(!pageModule.test(file.path)||/(?:^|\/)(?:api|admin|dashboard|seo-admin)(?:\/|$)/i.test(file.path))return null;
  const candidate=metadataCandidate(keyword,creative),titlePatterns=[/(title:\s*\{\s*absolute:\s*)"([^"]+)"/,/(title:\s*)"([^"]+)"/];
  let proposed=file.content,changed=false;const reason:string[]=[];
  for(const pattern of titlePatterns){const match=proposed.match(pattern);if(!match)continue;const brand=match[2].includes("|")?` | ${match[2].split("|").slice(1).join("|").trim()}`:"",replacement=`${match[1]}${JSON.stringify(`${candidate.title}${brand}`.slice(0,65))}`;proposed=proposed.replace(pattern,replacement);changed=true;reason.push("title");break;}
  const descriptionPatterns=[/(description:\s*)"([^"]*)"/,/(description:\s*)'([^']*)'/];for(const pattern of descriptionPatterns){const match=proposed.match(pattern);if(!match)continue;proposed=proposed.replace(pattern,`${match[1]}${JSON.stringify(candidate.description)}`);changed=true;reason.push("meta description");break;}
  if(creative){const h1=/<h1([^>]*)>([\s\S]*?)<\/h1>/i.exec(proposed);if(h1&& !/[<{]/.test(h1[2])){proposed=proposed.replace(h1[0],`<h1${h1[1]}>{${JSON.stringify(candidate.h1)}}</h1>`);changed=true;reason.push("H1");}}
  if(!changed)return null;
  return{filePath:file.path,originalSha:file.sha,originalContent:file.content,proposedContent:proposed,diff:`--- a/${file.path}\n+++ b/${file.path}\n@@ evidence-backed page fields @@\n- Existing ${reason.join(", ")}\n+ ${candidate.title} | ${candidate.description}`,reason:`Align the ${reason.join(", ")} with the selected query and approved creative evidence.`};
}

export function createNextPage(input:{root:"app"|"src/app";slug:string;creative:ApprovedCreative}){
  const sections=Array.isArray(input.creative.sections)?input.creative.sections.map(record).map(item=>({heading:text(item.heading)||text(item.title),body:text(item.body)})).filter(item=>item.heading&&item.body):[],faqs=Array.isArray(input.creative.faqs)?input.creative.faqs.map(record).map(item=>({question:text(item.question),answer:text(item.answer)})).filter(item=>item.question&&item.answer):[],schema=record(input.creative.schema_markup),filePath=`${input.root}/${input.slug}/page.tsx`,lines=[
    `export const metadata = {`,
    `  title: ${JSON.stringify(input.creative.title.slice(0,65))},`,
    `  description: ${JSON.stringify(input.creative.meta_description.slice(0,170))},`,
    `};`,
    ``,
    `export default function SeoLandingPage() {`,
    `  return (`,
    `    <main>`,
    `      <article>`,
    `        <h1>{${JSON.stringify(input.creative.h1)}}</h1>`,
    `        <p>{${JSON.stringify(input.creative.summary)}}</p>`,
    ...sections.flatMap(section=>[`        <section>`,`          <h2>{${JSON.stringify(section.heading)}}</h2>`,`          <p>{${JSON.stringify(section.body)}}</p>`,`        </section>`]),
    ...(faqs.length?[`        <section aria-labelledby="frequently-asked-questions">`,`          <h2 id="frequently-asked-questions">Frequently asked questions</h2>`,...faqs.flatMap(item=>[`          <h3>{${JSON.stringify(item.question)}}</h3>`,`          <p>{${JSON.stringify(item.answer)}}</p>`]),`        </section>`]:[]),
    ...(Object.keys(schema).length?[`        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ${JSON.stringify(JSON.stringify(schema))} }} />`]:[]),
    `      </article>`,
    `    </main>`,
    `  );`,
    `}`,
    ``,
  ],content=lines.join("\n");
  return{filePath,originalSha:null,originalContent:null,proposedContent:content,diff:`--- /dev/null\n+++ b/${filePath}\n@@ approved creative @@\n+ Evidence-constrained page: ${input.creative.title}`,reason:"Create the exact page from a human-approved, QA-passed creative draft backed by verified business proof."};
}
