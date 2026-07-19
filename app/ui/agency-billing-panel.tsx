"use client";

import {useEffect,useState} from "react";

type PlanKey="launch"|"growth"|"scale";
type Billing={subscription:{plan_key:PlanKey;status:string;price_cents:number;included_client_limit:number;included_scale_client_limit:number;current_period_end:string|null;cancel_at_period_end:boolean}|null;usage:{activeClients:number;scaleClients:number}};
type Payload={billing?:Billing;url?:string;error?:{message?:string}};

const plans=[
  {key:"launch" as const,name:"Agency Launch",price:"$499",clients:3,scale:0,detail:"Launch managed SEO for up to 3 active Core clients."},
  {key:"growth" as const,name:"Agency Growth",price:"$999",clients:8,scale:2,detail:"Manage up to 8 active clients, including 2 Scale seats."},
  {key:"scale" as const,name:"Agency Scale",price:"$2,299",clients:20,scale:5,detail:"Manage up to 20 active clients, including 5 Scale seats."},
];

export function AgencyBillingPanel({canManage}:{canManage:boolean}){
  const [billing,setBilling]=useState<Billing|null>(null),[busy,setBusy]=useState<string|null>(null),[message,setMessage]=useState("");
  async function load(){try{const response=await fetch("/api/agency-billing/status"),payload=await response.json() as Payload;if(!response.ok)throw new Error(payload.error?.message??"Agency billing could not be loaded.");setBilling(payload.billing??null);}catch(error){setMessage(error instanceof Error?error.message:"Agency billing could not be loaded.");}}
  useEffect(()=>{let active=true;fetch("/api/agency-billing/status").then(async response=>({response,payload:await response.json() as Payload})).then(({response,payload})=>{if(!active)return;if(!response.ok)throw new Error(payload.error?.message??"Agency billing could not be loaded.");setBilling(payload.billing??null);}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:"Agency billing could not be loaded.");});return()=>{active=false;};},[]);
  async function act(path:string,body:Record<string,unknown>,key:string){setBusy(key);setMessage("");try{const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),payload=await response.json() as Payload;if(!response.ok)throw new Error(payload.error?.message??"Billing could not be opened.");if(payload.url){window.location.assign(payload.url);return;}await load();setMessage("Agency plan updated. Stripe will apply any prorated amount automatically.");}catch(error){setMessage(error instanceof Error?error.message:"Billing could not be opened.");}finally{setBusy(null);}}
  const current=billing?.subscription,currentPlan=plans.find(plan=>plan.key===current?.plan_key);
  return <section className="agency-billing">
    <header><small>AGENCY SUBSCRIPTION</small><h1>Profitable capacity, billed clearly.</h1><p>Your agency plan pays for HD SEO access and a bounded number of active managed clients. Provider budgets and completed actions remain capped per client, protecting your margin.</p></header>
    {message&&<div className="agent-service-message">{message}</div>}
    {current&&<section className="agency-billing-status"><div><small>CURRENT PLAN</small><strong>{currentPlan?.name??current.plan_key}</strong><span>{current.status.replaceAll("_"," ")}{current.cancel_at_period_end?" · cancels at period end":""}</span></div><div><small>ACTIVE CLIENTS</small><strong>{billing.usage.activeClients} / {current.included_client_limit}</strong><span>{billing.usage.scaleClients} / {current.included_scale_client_limit} Scale seats used</span></div><div><small>NEXT BILLING DATE</small><strong>{current.current_period_end?new Date(current.current_period_end).toLocaleDateString():"Pending Stripe sync"}</strong></div>{canManage&&<button disabled={busy!==null} onClick={()=>void act("/api/agency-billing/portal",{},"portal")}>{busy==="portal"?"Opening…":"Manage billing"}</button>}</section>}
    <div className="agency-pricing-grid">{plans.map(plan=>{const selected=current?.plan_key===plan.key;return <article className={plan.key==="growth"?"featured":""} key={plan.key}><small>{plan.key==="growth"?"RECOMMENDED":"MONTHLY"}</small><h2>{plan.name}</h2><strong>{plan.price}<em>/mo</em></strong><p>{plan.detail}</p><ul><li>{plan.clients} active managed-client seats</li><li>{plan.scale?`${plan.scale} Managed Scale seats`:"Managed Core delivery"}</li><li>White-label client experience</li><li>Approvals, audit history and rollback</li><li>Hard provider and action limits</li></ul>{canManage&&<button disabled={busy!==null||selected} onClick={()=>{if(current&&!window.confirm(`Change your agency subscription to ${plan.name}? Stripe may apply a prorated charge or credit.`))return;void act(current?"/api/agency-billing/change-plan":"/api/agency-billing/checkout",{planKey:plan.key},plan.key);}}>{selected?"Current plan":busy===plan.key?"Opening secure billing…":current?`Change to ${plan.name}`:`Choose ${plan.name}`}</button>}</article>;})}</div>
    <footer><strong>Usage protection is built in.</strong><span>One action means one completed customer-visible deliverable. Internal handoffs, failed work and no-action reviews do not consume actions. Additional completed actions are $15 each and require an explicit purchase.</span></footer>
  </section>;
}
