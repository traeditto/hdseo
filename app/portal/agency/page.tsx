import { LiveAgencyDashboard } from "@/app/ui/live-agency-dashboard";
import { requirePortalUser } from "@/lib/auth/portal-user";
import { liveAgencySnapshot,upsertLiveUser } from "@/lib/live/store";
export const dynamic="force-dynamic";
export default async function AgencyPortal(){const user=await requirePortalUser("agency");await upsertLiveUser(user);return <LiveAgencyDashboard user={user} initialData={await liveAgencySnapshot(user.email.toLowerCase())}/>;}
