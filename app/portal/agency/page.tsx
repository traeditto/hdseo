import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { LiveAgencyDashboard } from "@/app/ui/live-agency-dashboard";
import { liveAgencySnapshot,upsertLiveUser } from "@/lib/live/store";
export const dynamic="force-dynamic";
export default async function AgencyPortal(){const user=await requireChatGPTUser("/portal/agency");await upsertLiveUser(user);return <LiveAgencyDashboard user={user} initialData={await liveAgencySnapshot(user.email.toLowerCase())}/>;}
