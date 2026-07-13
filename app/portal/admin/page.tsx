import { redirect } from "next/navigation";
import { resolvePortalAccess } from "@/lib/auth/portal-access";
import { PortalDashboard } from "@/app/ui/portal-dashboard";
export const dynamic="force-dynamic";
export default async function AdminPortal(){const access=await resolvePortalAccess("admin");if(!access)redirect("/login/admin");return <PortalDashboard portal="admin" identity={access}/>;}
