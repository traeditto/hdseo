"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PortalRole } from "@/lib/auth/portal-types";

const portalCopy = {
  admin: { number:"01", eyebrow:"PLATFORM CONTROL", title:"Admin Portal", description:"Secure access for HD SEO platform administrators.", accent:"Platform oversight, agency controls, system health, and security operations." },
  agency: { number:"02", eyebrow:"SEO OPERATIONS", title:"Agency Portal", description:"Sign in to operate your agency and client portfolio.", accent:"Prioritize opportunities, manage clients, approve work, and measure ranking outcomes." },
  client: { number:"03", eyebrow:"BUSINESS GROWTH", title:"Business Owner Portal", description:"Sign in to see results or start HD SEO for your business.", accent:"HD SEO finds the best local opportunities, completes safe work, and asks you only for simple business decisions." },
} as const;

export function PortalLogin({portal,authMode}:{portal:PortalRole;authMode:"supabase"|"chatgpt"}){
  const copy=portalCopy[portal],router=useRouter();
  const [status,setStatus]=useState<"idle"|"loading"|"recovery"|"signup">("idle"),[message,setMessage]=useState("");
  const [showPassword,setShowPassword]=useState(false);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setStatus("loading");setMessage("");
    const data=new FormData(event.currentTarget),email=String(data.get("email")||""),password=String(data.get("password")||""),db=createSupabaseBrowserClient();
    if(!db){setMessage("Production authentication is not configured for this deployment.");setStatus("idle");return;}
    const signedIn=await db.auth.signInWithPassword({email,password});
    if(signedIn.error){setMessage(signedIn.error.message);setStatus("idle");return;}
    const response=await fetch("/api/auth/portal-access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({portal})});
    const result=await response.json() as {destination?:string;error?:{message?:string}};
    if(!response.ok||!result.destination){await db.auth.signOut();setMessage(result.error?.message||`Your account does not have access to the ${copy.title}.`);setStatus("idle");return;}
    router.push(result.destination);router.refresh();
  }

  async function recover(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget),email=String(data.get("recoveryEmail")||""),db=createSupabaseBrowserClient();
    if(!db){setMessage("Password recovery is not configured for this deployment.");return;}
    const result=await db.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/login/${portal}`});
    setMessage(result.error?result.error.message:"Check your email for a secure password reset link.");
  }

  async function signup(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setMessage("");
    const data=new FormData(event.currentTarget),email=String(data.get("signupEmail")||""),password=String(data.get("signupPassword")||""),fullName=String(data.get("fullName")||""),db=createSupabaseBrowserClient();
    if(!db){setMessage("Production authentication is not configured for this deployment.");return;}
    const destination=portal==="client"?"/portal/client":"/portal/agency";
    const result=await db.auth.signUp({email,password,options:{data:{full_name:fullName},emailRedirectTo:`${window.location.origin}/auth/callback?next=${destination}`}});
    if(result.error){setMessage(result.error.message);return;}
    if(result.data.session){router.push(destination);router.refresh();return;}
    setMessage(portal==="client"?"Check your email to verify the account, then return here to add your business.":"Check your email to verify the account, then return here to create your agency workspace.");
  }

  async function sendMagicLink(form:HTMLFormElement){
    const email=String(new FormData(form).get("email")||""),db=createSupabaseBrowserClient();
    if(!email){setMessage("Enter your email address first.");return;}
    if(!db){setMessage("Production authentication is not configured for this deployment.");return;}
    setStatus("loading");setMessage("");
    const result=await db.auth.signInWithOtp({email,options:{emailRedirectTo:`${window.location.origin}/auth/callback?next=/portal/${portal}`,shouldCreateUser:false}});
    setMessage(result.error?result.error.message:"Check your email for your secure HD SEO sign-in link.");setStatus("idle");
  }

  return <main className={`portal-login-page portal-login-${portal}`}>
    <section className="portal-login-story"><Link className="login-brand" href="/"><span className="login-mark"><i/><b/></span><span>HD <em>SEO</em></span></Link><div><span className="story-number">{copy.number}</span><small>{copy.eyebrow}</small><h1>{copy.title}</h1><p>{copy.accent}</p></div><blockquote>“One clear system for turning search intelligence into accountable business growth.”</blockquote></section>
    <section className="portal-login-form"><div className="login-form-wrap"><Link className="back-link" href="/">← All portals</Link><span className="form-eyebrow">{copy.eyebrow}</span><h2>{status==="recovery"?"Reset your password":`Sign in to ${copy.title}`}</h2><p>{status==="recovery"?"Enter your account email and we’ll send a secure recovery link.":copy.description}</p>
      {authMode==="chatgpt"?<><div className="live-login-note"><strong>Secure hosted access</strong><p>Continue with your verified ChatGPT identity to enter this protected workspace.</p></div><Link className="login-submit live-login-button" href={`/portal/${portal}`}>Continue with ChatGPT <span>→</span></Link></>
      :status==="idle"||status==="loading"?<form onSubmit={submit}><label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required/></label><label>Password<span style={{position:"relative",display:"block"}}><input name="password" type={showPassword?"text":"password"} autoComplete="current-password" placeholder="Enter your password" required style={{width:"100%",paddingRight:"3.75rem"}}/><button type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?"Hide password":"Show password"} aria-pressed={showPassword} style={{position:"absolute",right:"0.85rem",top:"50%",transform:"translateY(-50%)",background:"none",border:"none",padding:0,cursor:"pointer",font:"inherit",fontSize:"0.8rem",fontWeight:600,color:"#2f6f5e"}}>{showPassword?"Hide":"Show"}</button></span></label><div className="login-options"><label><input type="checkbox"/> Remember me</label><button type="button" onClick={()=>{setStatus("recovery");setMessage("");}}>Forgot password?</button></div>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit" disabled={status==="loading"}>{status==="loading"?"Verifying access…":`Enter ${copy.title}`}<span>→</span></button><button className="recovery-back" type="button" disabled={status==="loading"} onClick={event=>{if(event.currentTarget.form)void sendMagicLink(event.currentTarget.form);}}>Email me a secure sign-in link</button></form>
      :status==="recovery"?<form onSubmit={recover}><label>Email address<input name="recoveryEmail" type="email" autoComplete="email" placeholder="you@company.com" required/></label>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit">Send recovery link <span>→</span></button><button className="recovery-back" type="button" onClick={()=>{setStatus("idle");setMessage("");}}>Back to sign in</button></form>
      :<form onSubmit={signup}><label>Your name<input name="fullName" autoComplete="name" required/></label><label>{portal==="client"?"Email address":"Work email"}<input name="signupEmail" type="email" autoComplete="email" placeholder={portal==="client"?"you@yourbusiness.com":"you@agency.com"} required/></label><label>Create password<input name="signupPassword" type="password" autoComplete="new-password" minLength={10} required/></label>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit">{portal==="client"?"Start my business account":"Create agency account"} <span>→</span></button><button className="recovery-back" type="button" onClick={()=>{setStatus("idle");setMessage("");}}>Back to sign in</button></form>}
      {(portal==="agency"||portal==="client")&&status!=="signup"&&<button className="recovery-back" type="button" onClick={()=>{setStatus("signup");setMessage("");}}>{portal==="client"?"New here? Start with your business":"Create a new agency account"}</button>}
      <small className="login-security">Protected by role-based authorization and encrypted session cookies.</small>
    </div></section>
  </main>;
}
