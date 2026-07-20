"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { PortalRole } from "@/lib/auth/portal-types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const portalLabels:Record<PortalRole,string>={admin:"Admin",agency:"Agency",client:"Business Owner"};

export function ResetPasswordForm({portal}:{portal:PortalRole}){
  const router=useRouter();
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[showPasswords,setShowPasswords]=useState(false),[message,setMessage]=useState("Checking your recovery link…");

  useEffect(()=>{
    let active=true;
    const db=createSupabaseBrowserClient();
    if(!db){const timer=window.setTimeout(()=>setMessage("Password recovery is not configured for this deployment."),0);return()=>window.clearTimeout(timer);}
    void db.auth.getUser().then(({data,error})=>{
      if(!active)return;
      if(error||!data.user){setMessage("This password reset link is invalid or expired. Request a new link from the sign-in page.");return;}
      setReady(true);setMessage("");
    });
    return()=>{active=false;};
  },[]);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||!ready)return;
    const data=new FormData(event.currentTarget),password=String(data.get("password")||""),confirmPassword=String(data.get("confirmPassword")||"");
    if(password.length<10){setMessage("Use at least 10 characters for your new password.");return;}
    if(password!==confirmPassword){setMessage("The two passwords do not match.");return;}
    const db=createSupabaseBrowserClient();
    if(!db){setMessage("Password recovery is not configured for this deployment.");return;}
    setBusy(true);setMessage("");
    const updated=await db.auth.updateUser({password});
    if(updated.error){setMessage(updated.error.message);setBusy(false);return;}
    const response=await fetch("/api/auth/portal-access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({portal})});
    const result=await response.json() as {destination?:string;error?:{message?:string}};
    if(!response.ok||!result.destination){setMessage(result.error?.message||"Your password was updated. Return to sign in to continue.");setBusy(false);return;}
    router.replace(result.destination);router.refresh();
  }

  return <main className="portal-login-page portal-login-client">
    <section className="portal-login-story"><Link className="login-brand" href="/"><span className="login-mark"><i/><b/></span><span>HD <em>SEO</em></span></Link><div><span className="story-number">SECURE</span><small>ACCOUNT RECOVERY</small><h1>Choose a new password</h1><p>Your recovery session is encrypted and expires automatically. HD SEO never receives or stores your password.</p></div><blockquote>“Secure access without slowing down the work that grows your business.”</blockquote></section>
    <section className="portal-login-form"><div className="login-form-wrap"><Link className="back-link" href={`/login/${portal}`}>← Return to {portalLabels[portal]} sign in</Link><span className="form-eyebrow">ACCOUNT RECOVERY</span><h2>Reset your password</h2><p>Create a new password, then continue directly to your {portalLabels[portal]} portal.</p>
      <form onSubmit={submit}><label>New password<span className="login-password-field"><input className="login-password-input" name="password" type={showPasswords?"text":"password"} autoComplete="new-password" minLength={10} disabled={!ready||busy} required/><button className="login-password-toggle" type="button" onClick={()=>setShowPasswords(value=>!value)} aria-label={showPasswords?"Hide passwords":"Show passwords"} aria-pressed={showPasswords}>{showPasswords?"Hide":"Show"}</button></span><small>Use at least 10 characters.</small></label><label>Confirm new password<input name="confirmPassword" type={showPasswords?"text":"password"} autoComplete="new-password" minLength={10} disabled={!ready||busy} required/></label>{message&&<div className="login-message" role="status">{message}</div>}<button className="login-submit" type="submit" disabled={!ready||busy}>{busy?"Saving new password…":"Save password and continue"}<span>→</span></button></form>
      {!ready&&<Link className="recovery-back" href={`/login/${portal}`}>Request another recovery email</Link>}<small className="login-security">Protected by Supabase Auth, encrypted sessions, and role-based portal access.</small>
    </div></section>
  </main>;
}
