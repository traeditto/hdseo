import { redirect } from "next/navigation";

import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { AdminSidebar } from "@/app/ui/admin-sidebar";
import { GitHubSettingsPanel } from "@/app/ui/github-settings-panel";
import { githubAdminSettingsSnapshot } from "@/lib/github/integration-settings";
import { upsertLiveUser } from "@/lib/live/store";

export const dynamic="force-dynamic";

export default async function GitHubSettingsPage({searchParams}:{searchParams:Promise<{agencyId?:string;github?:string}>}){
  const params=await searchParams;
  if(process.env.VERCEL){const origin=process.env.HD_SEO_LIVE_ORIGIN??"https://northstar-seo-os.hwxdyh9mww.chatgpt.site",target=new URL("/portal/admin/settings/github",origin);if(params.agencyId)target.searchParams.set("agencyId",params.agencyId);if(params.github)target.searchParams.set("github",params.github);redirect(target.toString())}
  const user=await requireChatGPTUser(`/portal/admin/settings/github${params.agencyId?`?agencyId=${encodeURIComponent(params.agencyId)}`:""}`);await upsertLiveUser(user);
  const snapshot=await githubAdminSettingsSnapshot(user,params.agencyId);
  return <main className="live-shell"><AdminSidebar user={user} active="github"/><section className="live-main"><header><div><small>PLATFORM ADMINISTRATION</small><strong>Settings / GitHub</strong></div><span className="github-header-status">Enterprise integration control</span></header><div className="live-content"><GitHubSettingsPanel snapshot={snapshot} justConnected={params.github==="connected"}/></div></section></main>;
}
