"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Factor = {id:string;status?:string;friendly_name?:string};

export function MfaSetup({returnTo}:{returnTo:string}) {
  const [factor,setFactor]=useState<Factor|null>(null),[qr,setQr]=useState(""),[code,setCode]=useState(""),[message,setMessage]=useState("Loading security settings…"),[busy,setBusy]=useState(true);
  useEffect(()=>{const prepare=async()=>{
    const db=createSupabaseBrowserClient();if(!db){setMessage("Authentication is not configured.");setBusy(false);return;}
    const listed=await db.auth.mfa.listFactors();
    const existing=listed.data?.totp?.find(item=>item.status==="verified")??listed.data?.totp?.[0];
    if(existing){setFactor(existing);setMessage(existing.status==="verified"?"Enter the six-digit code from your authenticator app.":"Finish verifying your authenticator.");setBusy(false);return;}
    const enrolled=await db.auth.mfa.enroll({factorType:"totp",friendlyName:"HD SEO privileged access"});
    if(enrolled.error||!enrolled.data){setMessage(enrolled.error?.message??"Authenticator enrollment could not be started.");setBusy(false);return;}
    setFactor(enrolled.data);setQr(enrolled.data.totp.qr_code);setMessage("Scan this code with your authenticator app, then enter the six-digit code.");setBusy(false);
  };void prepare()},[]);
  async function verify(event:FormEvent){
    event.preventDefault();if(!factor||busy)return;setBusy(true);setMessage("Verifying…");
    const db=createSupabaseBrowserClient();if(!db){setMessage("Authentication is not configured.");setBusy(false);return;}
    const challenge=await db.auth.mfa.challenge({factorId:factor.id});
    if(challenge.error||!challenge.data){setMessage(challenge.error?.message??"MFA challenge could not be created.");setBusy(false);return;}
    const verified=await db.auth.mfa.verify({factorId:factor.id,challengeId:challenge.data.id,code:code.replace(/\s/g,"")});
    if(verified.error){setMessage(verified.error.message);setBusy(false);return;}
    window.location.assign(returnTo);
  }
  return <main className="mfa-page"><section className="mfa-card"><small>PRIVILEGED ACCESS</small><h1>Protect HD SEO with two-step verification</h1><p>{message}</p>{qr&&<Image src={qr} alt="Authenticator enrollment QR code" width={240} height={240} unoptimized/>}<form onSubmit={verify}><label>Six-digit authenticator code<input value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required/></label><button disabled={busy||code.length!==6}>{busy?"Please wait…":"Verify and continue"}</button></form><p className="mfa-note">Store recovery codes offline. HD SEO support will never ask for this code.</p></section></main>;
}
