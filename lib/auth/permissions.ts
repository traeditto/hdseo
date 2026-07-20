export const agencyRoles = ["agency_owner", "agency_admin", "seo_director", "seo_strategist", "content_editor", "developer", "account_manager", "viewer"] as const;
export type AgencyRole = (typeof agencyRoles)[number];

export const permissionMatrix = {
  agency_owner: ["agency.manage", "billing.manage", "members.manage", "clients.manage", "client_portal.manage", "report.manage", "seo.read", "seo.write", "draft.create", "draft.edit", "draft.approve", "execution.edit", "execution.approve", "provider.authorize", "integrations.manage", "task.manage", "task.update", "deploy.create", "deploy.rollback"],
  agency_admin: ["members.manage", "clients.manage", "client_portal.manage", "report.manage", "seo.read", "seo.write", "draft.create", "draft.edit", "draft.approve", "execution.edit", "execution.approve", "provider.authorize", "integrations.manage", "task.manage", "task.update", "deploy.create", "deploy.rollback"],
  seo_director: ["clients.manage", "client_portal.manage", "report.manage", "seo.read", "seo.write", "draft.create", "draft.edit", "draft.approve", "execution.approve", "provider.authorize", "integrations.manage", "task.manage", "task.update", "deploy.create", "deploy.rollback"],
  seo_strategist: ["seo.read", "seo.write", "draft.create", "task.manage"],
  content_editor: ["seo.read", "draft.edit", "task.update"],
  developer: ["seo.read", "execution.edit", "task.update", "deploy.create"],
  account_manager: ["seo.read", "client_portal.manage", "task.manage", "report.manage"],
  viewer: ["seo.read"],
} as const satisfies Record<AgencyRole, readonly string[]>;

export function hasPermission(role: AgencyRole, permission: string): boolean {
  return (permissionMatrix[role] as readonly string[]).includes(permission);
}
