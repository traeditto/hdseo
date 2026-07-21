import type { Metadata } from "next";

import { WebsiteConnectionHandoff } from "@/app/ui/website-connection-handoff";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Secure website connection | HD SEO",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function WebsiteConnectionHandoffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <WebsiteConnectionHandoff token={token} />;
}
