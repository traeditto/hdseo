import { LiveAgencyDashboard } from "@/app/ui/live-agency-dashboard";
import { requirePortalUser } from "@/lib/auth/portal-user";
import { liveAgencySnapshot,upsertLiveUser } from "@/lib/live/store";
export const dynamic="force-dynamic";
export default async function AgencyPortal({searchParams}:{searchParams:Promise<{tab?:string;gsc?:string}>}){const params=await searchParams,user=await requirePortalUser("agency",`/portal/agency${params.tab?`?tab=${encodeURIComponent(params.tab)}`:""}`);await upsertLiveUser(user);return <LiveAgencyDashboard user={user} initialData={await liveAgencySnapshot(user.email.toLowerCase())} initialTab={params.tab}/>;}
