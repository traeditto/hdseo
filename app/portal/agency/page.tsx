import { redirect } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { LiveAgencyDashboard } from "@/app/ui/live-agency-dashboard";
import { liveAgencySnapshot,upsertLiveUser } from "@/lib/live/store";
export const dynamic="force-dynamic";
export default async function AgencyPortal(){if(process.env.VERCEL)redirect(`${process.env.HD_SEO_LIVE_ORIGIN??"https://northstar-seo-os.hwxdyh9mww.chatgpt.site"}/portal/agency`);const user=await requireChatGPTUser("/portal/agency");await upsertLiveUser(user);return <LiveAgencyDashboard user={user} initialData={await liveAgencySnapshot(user.email.toLowerCase())}/>;}
