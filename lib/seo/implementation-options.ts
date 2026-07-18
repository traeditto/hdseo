export type ImplementationChoice =
  | "wordpress_direct"
  | "shopify_direct"
  | "webflow_direct"
  | "repository_pr"
  | "repository_vercel"
  | "squarespace_guided"
  | "wordpress_package"
  | "generic_cms"
  | "developer_ticket"
  | "monitoring_only";

export type ImplementationReadiness = {
  projectId: string;
  cmsProvider: "wordpress" | "shopify" | "webflow" | null;
  cmsReady: boolean;
  repositoryConnected: boolean;
  repositoryReady: boolean;
  repositoryBlockers: string[];
  vercelConnected: boolean;
};

export type ImplementationOption = {
  value: ImplementationChoice;
  title: string;
  description: string;
  group: "automatic" | "guided";
  available: boolean;
  reason?: string;
  recommended?: boolean;
  setup?: boolean;
};

const repositoryBlockerLabels: Record<string, string> = {
  AGENCY_FEATURE_DISABLED: "Agency repository automation is not enabled.",
  PROJECT_FEATURE_DISABLED:
    "Repository automation is not enabled for this client.",
  MANUAL_WORKFLOW_NOT_VERIFIED:
    "Complete and verify one manual change before enabling code execution.",
  REPOSITORY_NOT_VERIFIED:
    "Connect and verify the client's GitHub repository.",
};

export function buildImplementationOptions(
  readiness: ImplementationReadiness | null,
  website: { cmsType: string } | null,
): ImplementationOption[] {
  const provider = readiness?.cmsProvider ?? null;
  const cmsReady = readiness?.cmsReady === true;
  const repositoryReady = readiness?.repositoryReady === true;
  const vercelReady = repositoryReady && readiness?.vercelConnected === true;
  const repositoryReason = readiness?.repositoryBlockers.length
    ? readiness.repositoryBlockers
        .map(
          (item) =>
            repositoryBlockerLabels[item] ?? item.replaceAll("_", " "),
        )
        .join(" ")
    : "Connect and verify a GitHub repository.";
  const recommended: ImplementationChoice = cmsReady
    ? (`${provider}_direct` as ImplementationChoice)
    : vercelReady
      ? "repository_vercel"
      : repositoryReady
        ? "repository_pr"
        : website?.cmsType === "squarespace"
          ? "squarespace_guided"
          : "generic_cms";
  const direct = (
    value: "wordpress_direct" | "shopify_direct" | "webflow_direct",
    name: "WordPress" | "Shopify" | "Webflow",
  ): ImplementationOption => {
    const available = cmsReady && provider === name.toLowerCase();
    return {
      value,
      title: `Publish automatically to ${name}`,
      description: `Prepare an approval-gated ${name} change with a stored pre-publish snapshot and rollback protection.`,
      group: "automatic",
      available,
      reason: available
        ? undefined
        : `Connect and verify ${name} for this client first.`,
      recommended: recommended === value,
      setup: !available,
    };
  };

  return [
    direct("wordpress_direct", "WordPress"),
    direct("shopify_direct", "Shopify"),
    direct("webflow_direct", "Webflow"),
    {
      value: "repository_vercel",
      title: "GitHub + Vercel deployment",
      description:
        "Prepare a bounded code change, request human approval, create a pull request, and track the Vercel deployment and rollback state.",
      group: "automatic",
      available: vercelReady,
      reason: !repositoryReady
        ? repositoryReason
        : !readiness?.vercelConnected
          ? "Connect this repository to an active Vercel project."
          : undefined,
      recommended: recommended === "repository_vercel",
      setup: !vercelReady,
    },
    {
      value: "repository_pr",
      title: "GitHub pull request",
      description:
        "Inspect the connected repository, prepare the change, and pause for approval before HD SEO opens a pull request.",
      group: "automatic",
      available: repositoryReady,
      reason: repositoryReady ? undefined : repositoryReason,
      recommended: recommended === "repository_pr",
      setup: !repositoryReady,
    },
    {
      value: "squarespace_guided",
      title: "Squarespace guided implementation",
      description:
        "Create exact page, metadata, and verification instructions for a Squarespace owner or editor.",
      group: "guided",
      available: true,
      recommended: recommended === "squarespace_guided",
    },
    {
      value: "wordpress_package",
      title: "WordPress implementation package",
      description:
        "Create a complete manual WordPress package when direct credentials are not available.",
      group: "guided",
      available: true,
      recommended: recommended === "wordpress_package",
    },
    {
      value: "generic_cms",
      title: "CMS implementation package",
      description:
        "Create platform-neutral instructions that an owner or website editor can complete safely.",
      group: "guided",
      available: true,
      recommended: recommended === "generic_cms",
    },
    {
      value: "developer_ticket",
      title: "Developer handoff",
      description:
        "Create technical requirements, acceptance criteria, verification checks, and rollback instructions.",
      group: "guided",
      available: true,
    },
    {
      value: "monitoring_only",
      title: "Monitoring only",
      description:
        "Track rankings and outcomes without allowing HD SEO to change the website.",
      group: "guided",
      available: true,
    },
  ];
}
