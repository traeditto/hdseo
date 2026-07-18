import { LiveClientBusinessDashboard } from "@/app/ui/live-client-dashboard";
import { requirePortalUser } from "@/lib/auth/portal-user";
import { liveClientSnapshot, upsertLiveUser } from "@/lib/live/store";
export const dynamic = "force-dynamic";
export default async function ClientPortal() {
  const user = await requirePortalUser("client");
  await upsertLiveUser(user);
  return (
    <LiveClientBusinessDashboard
      user={user}
      initialData={await liveClientSnapshot(user.email.toLowerCase())}
    />
  );
}
