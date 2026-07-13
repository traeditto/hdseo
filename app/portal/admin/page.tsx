import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { LiveAdminDashboard } from "@/app/ui/live-role-dashboard";
import { liveAdminSnapshot,upsertLiveUser } from "@/lib/live/store";
export const dynamic="force-dynamic";
export default async function AdminPortal(){const user=await requireChatGPTUser("/portal/admin");await upsertLiveUser(user);return <LiveAdminDashboard user={user} data={await liveAdminSnapshot(user.email.toLowerCase())}/>;}
