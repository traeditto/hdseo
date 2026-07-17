import { AdminSidebar } from "@/app/ui/admin-sidebar";
import { SystemReadinessDashboard } from "@/app/ui/system-readiness-dashboard";
import { requirePortalUser } from "@/lib/auth/portal-user";
import { upsertLiveUser } from "@/lib/live/store";
import { platformReadiness } from "@/lib/readiness/platform-readiness";

export const dynamic="force-dynamic";
export default async function AdminSystemPage(){const user=await requirePortalUser("admin","/portal/admin/system");await upsertLiveUser(user);return <main className="live-shell"><AdminSidebar user={user} active="system"/><section className="live-main"><header><div><small>PLATFORM ADMINISTRATION</small><strong>System readiness</strong></div><a className="github-header-link" href="/portal/admin/system">Refresh status</a></header><div className="live-content"><SystemReadinessDashboard readiness={await platformReadiness()}/></div></section></main>;}
