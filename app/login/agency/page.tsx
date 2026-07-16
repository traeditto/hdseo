import { PortalLogin } from "@/app/ui/portal-login";
export default function AgencyLoginPage(){return <PortalLogin portal="agency" authMode={process.env.VERCEL?"supabase":"chatgpt"}/>;}
