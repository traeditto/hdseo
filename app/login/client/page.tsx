import { PortalLogin } from "@/app/ui/portal-login";
export default function ClientLoginPage(){return <PortalLogin portal="client" authMode={process.env.VERCEL?"supabase":"chatgpt"}/>;}
