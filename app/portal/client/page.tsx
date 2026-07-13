import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { LiveClientDashboard } from "@/app/ui/live-role-dashboard";
import { liveClientSnapshot,upsertLiveUser } from "@/lib/live/store";
export const dynamic="force-dynamic";
export default async function ClientPortal(){const user=await requireChatGPTUser("/portal/client");await upsertLiveUser(user);return <LiveClientDashboard user={user} initialData={await liveClientSnapshot(user.email.toLowerCase())}/>;}
