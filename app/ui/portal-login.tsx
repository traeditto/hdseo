"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PortalRole } from "@/lib/auth/portal-types";

const portalCopy = {
  admin: { number:"01", eyebrow:"PLATFORM CONTROL", title:"Admin Portal", description:"Secure access for HD SEO platform administrators.", accent:"Platform oversight, agency controls, system health, and security operations." },
  agency: { number:"02", eyebrow:"SEO OPERATIONS", title:"Agency Portal", description:"Sign in to operate your agency and client portfolio.", accent:"Prioritize opportunities, manage clients, approve work, and measure ranking outcomes." },
  client: { number:"03", eyebrow:"CLIENT RESULTS", title:"Client Portal", description:"Your private view of SEO performance and approvals.", accent:"See progress, review recommendations, approve work, and access reports without agency complexity." },
} as const;

export function PortalLogin({portal}:{portal:PortalRole}){
  const copy=portalCopy[portal],router=useRouter();
  const [status,setStatus]=useState<"idle"|"loading"|"recovery">("idle"),[message,setMessage]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setStatus("loading");setMessage("");
    const data=new FormData(event.currentTarget),email=String(data.get("email")||""),password=String(data.get("password")||""),db=createSupabaseBrowserClient();
    if(!db){setMessage("Live authentication is awaiting the Supabase connection. Use Preview portal to explore this workspace.");setStatus("idle");return;}
    const signedIn=await db.auth.signInWithPassword({email,password});
    if(signedIn.error){setMessage(signedIn.error.message);setStatus("idle");return;}
    const response=await fetch("/api/auth/portal-access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({portal})});
    const result=await response.json() as {ok?:boolean;destination?:string;error?:{message?:string}};
    if(!response.ok||!result.destination){await db.auth.signOut();setMessage(result.error?.message||`Your account does not have access to the ${copy.title}.`);setStatus("idle");return;}
    router.push(result.destination);router.refresh();
  }
  async function recover(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget),email=String(data.get("recoveryEmail")||""),db=createSupabaseBrowserClient();if(!db){setMessage("Password recovery will activate when Supabase is connected.");return;}const result=await db.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/login/${portal}`});setMessage(result.error?result.error.message:"Check your email for a secure password reset link.");}
  return <main className={`portal-login-page portal-login-${portal}`}>
    <section className="portal-login-story"><Link className="login-brand" href="/"><span className="login-mark"><i/><b/></span><span>HD <em>SEO</em></span></Link><div><span className="story-number">{copy.number}</span><small>{copy.eyebrow}</small><h1>{copy.title}</h1><p>{copy.accent}</p></div><blockquote>“One clear system for turning search intelligence into accountable business growth.”</blockquote>
    </section>
    <section className="portal-login-form"><div className="login-form-wrap"><Link className="back-link" href="/">← All portals</Link><span className="form-eyebrow">{copy.eyebrow}</span><h2>{status==="recovery"?"Reset your password":`Sign in to ${copy.title}`}</h2><p>{status==="recovery"?"Enter your account email and we’ll send a secure recovery link.":copy.description}</p>
      {status!=="recovery"?<form onSubmit={submit}><label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required/></label><div className="login-options"><label><input type="checkbox"/> Remember me</label><button type="button" onClick={()=>{setStatus("recovery");setMessage("");}}>Forgot password?</button></div>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit" disabled={status==="loading"}>{status==="loading"?"Verifying access…":`Enter ${copy.title}`}<span>→</span></button></form>
      :<form onSubmit={recover}><label>Email address<input name="recoveryEmail" type="email" autoComplete="email" placeholder="you@company.com" required/></label>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit">Send recovery link <span>→</span></button><button className="recovery-back" type="button" onClick={()=>{setStatus("idle");setMessage("");}}>Back to sign in</button></form>}
      <div className="portal-preview"><span>Want to look around first?</span><Link href={`/portal/${portal}/preview`}>Preview {copy.title} →</Link></div><small className="login-security">Protected by role-based authorization and encrypted session cookies.</small>
    </div></section>
  </main>;
}
