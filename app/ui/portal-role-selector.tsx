import Link from "next/link";

import type { PortalRole } from "@/lib/auth/portal-types";

export const portalRoles = [
  {
    role: "admin",
    number: "01",
    eyebrow: "PLATFORM CONTROL",
    title: "Admin",
    cardTitle: "Platform Admin",
    description: "Operate HD SEO platform security, agencies, system health, and integrations.",
    features: ["Platform oversight", "Agency controls", "System readiness"],
  },
  {
    role: "agency",
    number: "02",
    eyebrow: "SEO OPERATIONS",
    title: "Agency",
    cardTitle: "Agency",
    description: "Manage your agency, client portfolio, approvals, campaigns, and outcomes.",
    features: ["Client portfolio", "Approval inbox", "White-label operations"],
  },
  {
    role: "client",
    number: "03",
    eyebrow: "BUSINESS GROWTH",
    title: "Business Owner",
    cardTitle: "Business Owner",
    description: "See what HD SEO found, approve recommended work, and track business results.",
    features: ["Simple recommendations", "Approve or decline", "Leads and ROI"],
  },
] as const satisfies ReadonlyArray<{
  role: PortalRole;
  number: string;
  eyebrow: string;
  title: string;
  cardTitle: string;
  description: string;
  features: readonly string[];
}>;

export function PortalRoleSelector({ activeRole }: { activeRole?: PortalRole }) {
  return <nav className="portal-role-toggle" aria-label="Choose sign-in portal">
    {portalRoles.map((item) => <Link
      key={item.role}
      href={`/login/${item.role}`}
      className={activeRole === item.role ? "active" : undefined}
      aria-current={activeRole === item.role ? "page" : undefined}
    >{item.title}</Link>)}
  </nav>;
}
