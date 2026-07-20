import type { Metadata } from "next";

import { PortalLogin } from "@/app/ui/portal-login";

export const metadata:Metadata={
  title:"Start a free SEO trial | HD SEO",
  description:"Create a verified HD SEO business account and run one free crawl of up to 25 public website pages. No credit card required.",
  alternates:{canonical:"/register"},
  robots:{index:true,follow:true},
};

export default function RegisterPage(){
  return <PortalLogin portal="client" authMode={process.env.VERCEL?"supabase":"chatgpt"} initialMode="signup"/>;
}
