import { AdminSidebar } from "@/app/ui/admin-sidebar";
import { GitHubSettingsPanel } from "@/app/ui/github-settings-panel";
import { requirePortalUser } from "@/lib/auth/portal-user";
import { requirePortalAal2 } from "@/lib/auth/mfa";
import { githubAdminSettingsSnapshot } from "@/lib/github/integration-settings";
import { upsertLiveUser } from "@/lib/live/store";

export const dynamic="force-dynamic";

export default async function GitHubSettingsPage({searchParams}:{searchParams:Promise<{agencyId?:string;github?:string}>}){
  const params=await searchParams;
  const returnTo=`/portal/admin/settings/github${params.agencyId?`?agencyId=${encodeURIComponent(params.agencyId)}`:""}`,user=await requirePortalUser("admin",returnTo);await requirePortalAal2(returnTo);await upsertLiveUser(user);
  const snapshot=await githubAdminSettingsSnapshot(user,params.agencyId);
  return <main className="live-shell"><AdminSidebar user={user} active="github"/><section className="live-main"><header><div><small>PLATFORM ADMINISTRATION</small><strong>Settings / GitHub</strong></div><span className="github-header-status">Enterprise integration control</span></header><div className="live-content"><GitHubSettingsPanel snapshot={snapshot} justConnected={params.github==="connected"}/></div></section></main>;
}
