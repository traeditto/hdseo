"use client";

import { FormEvent, useMemo, useState } from "react";

type Project = { id:string; clientId:string; name:string; domain:string };
type Website = {
  id:string; projectId:string; name:string; siteUrl:string; canonicalDomain:string;
  cmsType:string; status:string; lastVerifiedAt:string|null; connectionId:string|null;
  connectionMode:string|null; connectionStatus:string|null; editorMode:string|null;
  googleSearchConsole:{id:string;status:string;selectedProperty:string|null;lastSyncedAt:string|null;lastVerifiedAt:string|null;properties:Array<{siteUrl:string;permissionLevel?:string}>;health:string}|null;
};
type Mode = "wordpress"|"shopify"|"webflow"|"github"|"manual"|"monitoring"|"managed";

const methods:Array<{mode:Mode;title:string;description:string;icon:string}>=[
  {mode:"wordpress",title:"WordPress",description:"Verify a WordPress Application Password and enable REST API publishing.",icon:"W"},
  {mode:"shopify",title:"Shopify",description:"Connect through the Shopify Admin GraphQL API using a store access token.",icon:"S"},
  {mode:"webflow",title:"Webflow",description:"Authorize the selected Webflow site through its secure Data API token.",icon:"F"},
  {mode:"github",title:"GitHub + Vercel",description:"Install the HD SEO GitHub App for repository-driven deployments and rollback.",icon:"G"},
  {mode:"manual",title:"Another website platform",description:"Use an implementation package and accountable CMS or developer handoff.",icon:"M"},
  {mode:"monitoring",title:"Monitoring only",description:"Analyze rankings, technical SEO, and outcomes without editing the website.",icon:"◎"},
  {mode:"managed",title:"HD SEO managed migration",description:"Request a reviewed onboarding path for an unsupported or legacy platform.",icon:"H"},
];

function human(value:string|null|undefined){return (value||"not connected").replaceAll("_"," ");}

export function WebsiteConnections({agencyId,projects,websites,canManage,busy,onAction}:{agencyId:string;projects:Project[];websites:Website[];canManage:boolean;busy:boolean;onAction:(body:Record<string,unknown>)=>Promise<boolean>}){
  const [projectId,setProjectId]=useState(projects[0]?.id??"");
  const [open,setOpen]=useState(false);
  const [mode,setMode]=useState<Mode>("wordpress");
  const [integrationBusy,setIntegrationBusy]=useState<string|null>(null);
  const [integrationMessage,setIntegrationMessage]=useState("");
  const selected=projects.find(project=>project.id===projectId)??projects[0];
  const websiteByProject=useMemo(()=>new Map(websites.map(website=>[website.projectId,website])),[websites]);
  function begin(nextProjectId:string){setProjectId(nextProjectId);setMode("wordpress");setOpen(true);}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!selected||mode==="github")return;
    const data=new FormData(event.currentTarget),success=await onAction({
      action:"connect_website",projectId:selected.id,mode,
      siteUrl:String(data.get("siteUrl")||selected.domain),
      username:String(data.get("username")||"")||undefined,
      applicationPassword:String(data.get("applicationPassword")||"")||undefined,
      accessToken:String(data.get("accessToken")||"")||undefined,
      siteId:String(data.get("siteId")||"")||undefined,
      platformName:String(data.get("platformName")||"")||undefined,
      notes:String(data.get("notes")||"")||undefined,
    });
    if(success)setOpen(false);
  }
  async function integration(path:string,body:Record<string,unknown>,key:string){setIntegrationBusy(key);setIntegrationMessage("");try{const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),result=await response.json();if(!response.ok){setIntegrationMessage(result.error?.message??"The evidence action could not be completed.");return;}setIntegrationMessage(result.message??"Evidence action queued.");}catch{setIntegrationMessage("The evidence action could not be reached. Try again.");}finally{setIntegrationBusy(null);}}
  async function chooseProperty(project:string,property:string){await integration("/api/google/properties",{projectId:project,property},"property");}
  if(!projects.length)return <section className="live-section"><div className="live-empty"><strong>Add a client before connecting a website</strong><p>Every website connection belongs to a client SEO project.</p></div></section>;
  return <>
    <div className="live-heading website-heading"><div><small>CLIENT WEBSITE ACCESS</small><h1>Website connections</h1><p>Connect each client using the method that matches how their site is managed. GitHub is optional.</p></div>{canManage&&<button onClick={()=>begin(projects[0].id)}>＋ Connect website</button>}</div>
    <section className="website-grid">
      {projects.map(project=>{const website=websiteByProject.get(project.id),connected=website?.connectionStatus==="active"||website?.status==="active";return <article className="website-card" key={project.id}>
        <header><span className={connected?"website-dot connected":"website-dot"}/><div><strong>{project.domain}</strong><small>{project.name}</small></div><em className={connected?"connected":""}>{connected?"CONNECTED":human(website?.status).toUpperCase()}</em></header>
        <dl><div><dt>Connection</dt><dd>{human(website?.connectionMode)}</dd></div><div><dt>Platform</dt><dd>{human(website?.cmsType)}</dd></div><div><dt>Last verified</dt><dd>{website?.lastVerifiedAt?new Date(website.lastVerifiedAt).toLocaleString():"Not yet"}</dd></div></dl>
        <footer>{canManage&&<button onClick={()=>begin(project.id)}>{website?.connectionId?"Reconnect":"Choose connection"}</button>}{website?.connectionId&&canManage&&<button disabled={busy} onClick={()=>void onAction({action:"test_website",websiteId:website.id})}>Test connection</button>}{website?.connectionId&&canManage&&<button className="danger" disabled={busy} onClick={()=>{if(window.confirm(`Disconnect ${project.domain} and remove its stored credentials?`))void onAction({action:"disconnect_website",websiteId:website.id,confirm:true});}}>Disconnect</button>}</footer>
        <div className="website-evidence"><header><div><small>SEARCH CONSOLE EVIDENCE</small><strong>{website?.googleSearchConsole?.selectedProperty??"Not connected"}</strong></div><em className={website?.googleSearchConsole?.status==="active"?"connected":""}>{website?.googleSearchConsole?.status==="active"?"CONNECTED":"NOT CONNECTED"}</em></header>{website?.googleSearchConsole?.status!=="active"?<a className="evidence-link" href={`/api/google/connect?projectId=${encodeURIComponent(project.id)}`}>Connect Google Search Console →</a>:<>{!website.googleSearchConsole.selectedProperty&&website.googleSearchConsole.properties.length>0&&<div className="evidence-property"><select defaultValue="" onChange={event=>void chooseProperty(project.id,event.target.value)} disabled={integrationBusy!==null}><option value="" disabled>Select authorized property</option>{website.googleSearchConsole.properties.map(property=><option value={property.siteUrl} key={property.siteUrl}>{property.siteUrl}</option>)}</select></div>}<div className="evidence-actions"><button disabled={integrationBusy!==null} onClick={()=>void integration("/api/google/sync",{projectId:project.id},"sync")}>{integrationBusy==="sync"?"Queueing…":"Refresh Search Console"}</button><button disabled={integrationBusy!==null} onClick={()=>void integration("/api/crawler/run",{projectId:project.id},"crawl")}>{integrationBusy==="crawl"?"Queueing…":"Crawl website"}</button><button className="danger" disabled={integrationBusy!==null} onClick={()=>{if(window.confirm("Disconnect Search Console and remove its stored authorization?"))void integration("/api/google/disconnect",{projectId:project.id,confirm:true},"disconnect");}}>Disconnect</button></div><small className="evidence-last">Last sync: {website.googleSearchConsole.lastSyncedAt?new Date(website.googleSearchConsole.lastSyncedAt).toLocaleString():"Not yet"}</small></>}</div>{integrationMessage&&<div className="evidence-message">{integrationMessage}</div>}
      </article>})}
    </section>
    {open&&selected&&<div className="modal-backdrop" onMouseDown={()=>!busy&&setOpen(false)}><div className="modal website-modal live-dialog" onMouseDown={event=>event.stopPropagation()}><button className="modal-close" disabled={busy} onClick={()=>setOpen(false)}>×</button><small>CONNECT {selected.domain.toUpperCase()}</small><h2>How is this website managed?</h2><p>Choose one option. Credentials are verified on the server, encrypted before storage, and never returned to the browser.</p>
      <div className="connection-methods">{methods.map(method=><button type="button" key={method.mode} className={mode===method.mode?"active":""} onClick={()=>setMode(method.mode)}><b>{method.icon}</b><span><strong>{method.title}</strong><small>{method.description}</small></span></button>)}</div>
      {mode==="github"?<div className="connection-provider-action"><p>GitHub will ask which repository HD SEO may access, then return you to this workspace.</p><a className="github-primary" href={`/api/github/install?agencyId=${encodeURIComponent(agencyId)}&clientId=${encodeURIComponent(selected.clientId)}&projectId=${encodeURIComponent(selected.id)}&returnUrl=${encodeURIComponent("/portal/agency?github=connected")}`}>Connect GitHub repository →</a></div>:
      <form className="workflow-form website-form" onSubmit={submit}>
        {mode!=="shopify"&&<label>Public website URL<input name="siteUrl" defaultValue={`https://${selected.domain}`} type="url" inputMode="url" required/></label>}
        {mode==="wordpress"&&<><label>WordPress username<input name="username" autoComplete="username" required/></label><label>WordPress Application Password<input name="applicationPassword" type="password" autoComplete="new-password" required/><small>Create this under WordPress → Users → Profile → Application Passwords. Do not use the normal account password.</small></label></>}
        {mode==="shopify"&&<><label>Permanent Shopify store domain<input name="siteUrl" defaultValue={selected.domain.endsWith(".myshopify.com")?`https://${selected.domain}`:""} placeholder="https://store-name.myshopify.com" required/></label><label>Shopify Admin API access token<input name="accessToken" type="password" autoComplete="new-password" placeholder="shpat_…" required/></label></>}
        {mode==="webflow"&&<><label>Webflow site ID<input name="siteId" required/></label><label>Webflow API token<input name="accessToken" type="password" autoComplete="new-password" required/></label></>}
        {mode==="manual"&&<label>Website platform<input name="platformName" placeholder="Squarespace, Wix, Drupal, custom CMS…" required/></label>}
        {mode==="managed"&&<label>Onboarding notes<textarea name="notes" placeholder="Describe the platform, hosting access, and any migration constraints." required minLength={10}/></label>}
        {mode==="monitoring"&&<div className="discovery-note"><strong>No editing access required</strong><p>HD SEO will monitor the public site and connected search data. Changes remain review-ready handoffs.</p></div>}
        <button disabled={busy}>{busy?"Verifying secure connection…":mode==="managed"?"Request managed onboarding":mode==="monitoring"?"Enable monitoring":"Verify and connect website"}</button>
      </form>}
    </div></div>}
  </>;
}
