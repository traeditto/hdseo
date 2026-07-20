"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";

import type { PortalRole } from "@/lib/auth/portal-types";
import { PortalRoleSelector } from "@/app/ui/portal-role-selector";

const portalCopy = {
  admin: { number:"01", eyebrow:"PLATFORM CONTROL", title:"Admin Portal", description:"Secure access for HD SEO platform administrators.", accent:"Platform oversight, agency controls, system health, and security operations." },
  agency: { number:"02", eyebrow:"SEO OPERATIONS", title:"Agency Portal", description:"Sign in to operate your agency and client portfolio.", accent:"Prioritize opportunities, manage clients, approve work, and measure ranking outcomes." },
  client: { number:"03", eyebrow:"BUSINESS GROWTH", title:"Business Owner Portal", description:"Sign in to see results or start HD SEO for your business.", accent:"HD SEO finds the best local opportunities, completes safe work, and asks you only for simple business decisions." },
} as const;

const productionAuthOrigin=(process.env.NEXT_PUBLIC_APP_URL||"https://hdseo.vercel.app").replace(/\/+$/g,"");
const turnstileSiteKey=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function PortalLogin({portal,authMode,initialMode="signin"}:{portal:PortalRole;authMode:"supabase"|"chatgpt";initialMode?:"signin"|"signup"}){
  const copy=portalCopy[portal],router=useRouter();
  const [status,setStatus]=useState<"idle"|"loading"|"recovery"|"signup">(initialMode==="signup"?"signup":"idle"),[message,setMessage]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [showSignupPassword,setShowSignupPassword]=useState(false);
  const [signupBusy,setSignupBusy]=useState(false);
  const [pendingVerification,setPendingVerification]=useState<{email:string;destination:string}|null>(null);

  useEffect(()=>{
    if(window.location.hostname.endsWith(".vercel.app")&&window.location.origin!==productionAuthOrigin){window.location.replace(new URL(`${window.location.pathname}${window.location.search}`,`${productionAuthOrigin}/`).toString());return;}
    const authError=new URLSearchParams(window.location.search).get("error");
    const authMessage=authError==="invalid_or_expired_link"?"That confirmation link is invalid, expired, or was already used. Sign in if your email is verified, or create the account again to request a fresh link.":authError==="auth_not_configured"?"Production authentication is temporarily unavailable.":null;
    if(authMessage){const timer=window.setTimeout(()=>setMessage(authMessage),0);return()=>window.clearTimeout(timer);}
  },[]);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setStatus("loading");setMessage("");
    const data=new FormData(event.currentTarget),email=String(data.get("email")||""),password=String(data.get("password")||"");
    const signedIn=await fetch("/api/auth/signin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})}),signedInBody=await signedIn.json() as {error?:{message?:string}};
    if(!signedIn.ok){setMessage(signedInBody.error?.message??"Sign in could not be completed.");setStatus("idle");return;}
    const response=await fetch("/api/auth/portal-access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({portal})});
    const result=await response.json() as {destination?:string;error?:{message?:string}};
    if(!response.ok||!result.destination){await fetch("/api/auth/signout",{method:"POST"});setMessage(result.error?.message||`Your account does not have access to the ${copy.title}.`);setStatus("idle");return;}
    router.push(result.destination);router.refresh();
  }

  async function recover(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget),email=String(data.get("recoveryEmail")||"");
    const result=await fetch("/api/auth/recovery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,portal,action:"password_reset"})}),body=await result.json() as {error?:{message?:string}};
    setMessage(result.ok?"Check your email for a secure password reset link.":body.error?.message??"The recovery email could not be requested.");
  }

  async function signup(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(signupBusy)return;
    setSignupBusy(true);setMessage("");setPendingVerification(null);
    const data=new FormData(event.currentTarget),email=String(data.get("signupEmail")||""),password=String(data.get("signupPassword")||""),fullName=String(data.get("fullName")||""),turnstileToken=String(data.get("cf-turnstile-response")||"");
    const destination=portal==="client"?"/portal/client?welcome=1":"/portal/agency";
    const response=await fetch("/api/auth/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,fullName,portal,turnstileToken})}),result=await response.json() as {session?:boolean;destination?:string;error?:{message?:string}};
    if(!response.ok){setMessage(result.error?.message??"The account could not be created.");setSignupBusy(false);return;}
    if(result.session){router.push(result.destination??destination);router.refresh();return;}
    setPendingVerification({email,destination});
    setMessage(portal==="client"?"Check your email to verify the account, then return here to add your business.":"Check your email to verify the account, then return here to create your agency workspace.");
    setSignupBusy(false);
  }

  async function resendConfirmation(){
    if(!pendingVerification||signupBusy)return;
    setSignupBusy(true);setMessage("");
    const result=await fetch("/api/auth/recovery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:pendingVerification.email,portal,action:"resend_signup"})}),body=await result.json() as {error?:{message?:string}};
    setMessage(result.ok?"A new verification email was requested. Check your inbox and spam folder; delivery can take a minute.":body.error?.message??"The verification email could not be requested.");setSignupBusy(false);
  }

  async function sendMagicLink(form:HTMLFormElement){
    const email=String(new FormData(form).get("email")||"");
    if(!email){setMessage("Enter your email address first.");return;}
    setStatus("loading");setMessage("");
    const result=await fetch("/api/auth/recovery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,portal,action:"magic_link"})}),body=await result.json() as {error?:{message?:string}};
    setMessage(result.ok?"Check your email for your secure HD SEO sign-in link.":body.error?.message??"The secure sign-in link could not be requested.");setStatus("idle");
  }

  return <main className={`portal-login-page portal-login-${portal}`}>
    <section className="portal-login-story"><Link className="login-brand" href="/"><span className="login-mark"><i/><b/></span><span>HD <em>SEO</em></span></Link><div><span className="story-number">{copy.number}</span><small>{copy.eyebrow}</small><h1>{copy.title}</h1><p>{copy.accent}</p></div><blockquote>“One clear system for turning search intelligence into accountable business growth.”</blockquote></section>
    <section className="portal-login-form"><div className="login-form-wrap"><Link className="back-link" href="/login">← All portals</Link><PortalRoleSelector activeRole={portal} /><span className="form-eyebrow">{copy.eyebrow}</span><h2>{status==="recovery"?"Reset your password":status==="signup"&&portal==="client"?"Create your free business account":status==="signup"?"Create your agency account":`Sign in to ${copy.title}`}</h2><p>{status==="recovery"?"Enter your account email and we’ll send a secure recovery link.":status==="signup"&&portal==="client"?"Verify your email, add one business website, and run one free crawl of up to 25 public pages. No credit card required.":copy.description}</p>
      {status==="signup"&&portal==="client"&&<div className="signup-trial-facts"><strong>Your free trial includes</strong><span>✓ One website workspace</span><span>✓ One crawl of up to 25 public pages</span><span>✓ Access to explore the plans, approvals, agent, and results UI</span><small>Paid data providers, ongoing agents, publishing, and external spend stay locked until you choose a plan.</small></div>}
      {authMode==="chatgpt"?<><div className="live-login-note"><strong>Secure hosted access</strong><p>Continue with your verified ChatGPT identity to enter this protected workspace.</p></div><Link className="login-submit live-login-button" href={`/portal/${portal}`}>Continue with ChatGPT <span>→</span></Link></>
      :status==="idle"||status==="loading"?<form onSubmit={submit}><label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required/></label><label>Password<span className="login-password-field"><input className="login-password-input" name="password" type={showPassword?"text":"password"} autoComplete="current-password" placeholder="Enter your password" required/><button className="login-password-toggle" type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?"Hide password":"Show password"} aria-pressed={showPassword}>{showPassword?"Hide":"Show"}</button></span></label><div className="login-options"><label><input type="checkbox"/> Remember me</label><button type="button" onClick={()=>{setStatus("recovery");setMessage("");}}>Forgot password?</button></div>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit" disabled={status==="loading"}>{status==="loading"?"Verifying access…":`Enter ${copy.title}`}<span>→</span></button><button className="recovery-back" type="button" disabled={status==="loading"} onClick={event=>{if(event.currentTarget.form)void sendMagicLink(event.currentTarget.form);}}>Email me a secure sign-in link</button></form>
      :status==="recovery"?<form onSubmit={recover}><label>Email address<input name="recoveryEmail" type="email" autoComplete="email" placeholder="you@company.com" required/></label>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit">Send recovery link <span>→</span></button><button className="recovery-back" type="button" onClick={()=>{setStatus("idle");setMessage("");}}>Back to sign in</button></form>
      :<form onSubmit={signup}><label>Your name<input name="fullName" autoComplete="name" required/></label><label>{portal==="client"?"Email address":"Work email"}<input name="signupEmail" type="email" autoComplete="email" placeholder={portal==="client"?"you@yourbusiness.com":"you@agency.com"} required/></label><label>Create password<span className="login-password-field"><input className="login-password-input" name="signupPassword" type={showSignupPassword?"text":"password"} autoComplete="new-password" minLength={10} maxLength={128} required/><button className="login-password-toggle" type="button" onClick={()=>setShowSignupPassword(value=>!value)} aria-label={showSignupPassword?"Hide password":"Show password"} aria-pressed={showSignupPassword}>{showSignupPassword?"Hide":"Show"}</button></span><small>Use at least 10 characters.</small></label><label className="signup-consent"><input type="checkbox" required/><span>I agree to the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Policy</Link>.</span></label>{turnstileSiteKey&&<><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive"/><div className="cf-turnstile" data-sitekey={turnstileSiteKey}/></>}{message&&<div className="login-message" role="status">{message}</div>}{pendingVerification&&<button className="recovery-back" type="button" disabled={signupBusy} onClick={()=>void resendConfirmation()}>{signupBusy?"Requesting email…":"Resend verification email"}</button>}<button className="login-submit" type="submit" disabled={signupBusy}>{signupBusy?"Creating your account…":portal==="client"?"Create account and start free":"Create agency account"} <span>→</span></button><button className="recovery-back" type="button" disabled={signupBusy} onClick={()=>{setStatus("idle");setMessage("");setPendingVerification(null);}}>Already have an account? Sign in</button></form>}
      {(portal==="agency"||portal==="client")&&status!=="signup"&&<button className="recovery-back" type="button" onClick={()=>{setStatus("signup");setMessage("");}}>{portal==="client"?"New here? Start with your business":"Create a new agency account"}</button>}
      <small className="login-security">Protected by role-based authorization and encrypted session cookies.</small>
    </div></section>
  </main>;
}
