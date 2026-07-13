import { redirect } from "next/navigation";
import { resolvePortalAccess } from "@/lib/auth/portal-access";
import { PortalDashboard } from "@/app/ui/portal-dashboard";
export const dynamic="force-dynamic";
export default async function ClientPortal(){const access=await resolvePortalAccess("client");if(!access)redirect("/login/client");return <PortalDashboard portal="client" identity={access}/>;}
