import { LiveAdminDashboard } from "@/app/ui/live-role-dashboard";
import { requirePortalUser } from "@/lib/auth/portal-user";
import { liveAdminSnapshot,upsertLiveUser } from "@/lib/live/store";
import { requirePortalAal2 } from "@/lib/auth/mfa";
export const dynamic="force-dynamic";
export default async function AdminPortal(){const user=await requirePortalUser("admin");await requirePortalAal2("/portal/admin");await upsertLiveUser(user);return <LiveAdminDashboard user={user} data={await liveAdminSnapshot(user.email.toLowerCase())}/>;}
