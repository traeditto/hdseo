import { AdminSidebar } from "@/app/ui/admin-sidebar";
import { SystemReadinessDashboard } from "@/app/ui/system-readiness-dashboard";
import { requirePortalUser } from "@/lib/auth/portal-user";
import { upsertLiveUser } from "@/lib/live/store";
import { platformReadiness } from "@/lib/readiness/platform-readiness";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function AdminSystemPage(){
  const user=await requirePortalUser("admin","/portal/admin/system");
  await upsertLiveUser(user);
  const db=createSupabaseAdminClient(),projects=db?await db.from("seo_projects").select("id,name,domain,client_organizations(name)").eq("status","active").order("created_at",{ascending:false}).limit(100):{data:[]};
  const options=(projects.data??[]).map(row=>{const client=Array.isArray(row.client_organizations)?row.client_organizations[0]:row.client_organizations;return{id:row.id,label:`${client?.name??row.name} · ${row.domain}`};});
  return <main className="live-shell"><AdminSidebar user={user} active="system"/><section className="live-main"><header><div><small>PLATFORM ADMINISTRATION</small><strong>System readiness</strong></div><a className="github-header-link" href="/portal/admin/system">Refresh status</a></header><div className="live-content"><SystemReadinessDashboard readiness={await platformReadiness()} projects={options}/></div></section></main>;
}
