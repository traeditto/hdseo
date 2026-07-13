import { redirect } from "next/navigation";
import { AgencyDashboard } from "@/app/ui/agency-dashboard";
import { resolvePortalAccess } from "@/lib/auth/portal-access";
export const dynamic="force-dynamic";
export default async function AgencyPortal(){if(!await resolvePortalAccess("agency"))redirect("/login/agency");return <AgencyDashboard portalAccess/>;}
