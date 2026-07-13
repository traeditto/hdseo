export const portalRoles=["admin","agency","client"] as const;
export type PortalRole=(typeof portalRoles)[number];
export type PortalIdentity={userId:string;email:string;displayName:string;organization:string;role:string;destination:string};
export function isPortalRole(value:unknown):value is PortalRole{return typeof value==="string"&&portalRoles.includes(value as PortalRole);}
