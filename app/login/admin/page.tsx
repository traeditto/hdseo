import { PortalLogin } from "@/app/ui/portal-login";
export default function AdminLoginPage(){return <PortalLogin portal="admin" authMode={process.env.VERCEL?"supabase":"chatgpt"}/>;}
