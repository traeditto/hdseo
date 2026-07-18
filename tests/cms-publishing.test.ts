import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("provider-native CMS publishing",()=>{
  it("retains tenant-scoped before and after snapshots for rollback",()=>{
    const sql=read("supabase/migrations/0020_cms_publication_control_plane.sql");
    for(const field of ["before_snapshot","after_snapshot","idempotency_key","provider_resource_id","rolled_back_at"])expect(sql).toContain(field);
    expect(sql).toContain("public.is_agency_member(agency_id)");
    expect(sql).toContain("revoke insert,update,delete");
  });

  it("implements real WordPress, Shopify, and Webflow write and rollback paths",()=>{
    const service=read("lib/websites/publishing.ts");
    for(const operation of ["publishWordPress","rollbackWordPress","publishShopify","rollbackShopify","publishWebflow","rollbackWebflow"])expect(service).toContain(operation);
    expect(service).toContain("/wp-json/wp/v2/pages/");
    expect(service).toContain("pageUpdate");
    expect(service).toContain("/v2/pages/");
    expect(service).toContain("/publish");
    expect(service).toContain("A newer publication exists");
  });

  it("exposes only approval-gated publish and guarded rollback actions",()=>{
    const route=read("app/api/implementation-packages/[packageId]/route.ts"),portal=read("app/api/live/route.ts"),service=read("lib/websites/publishing.ts");
    expect(service).toContain('pkg.status!=="client_approved"');
    expect(route).toContain('requirePermission(context,"execution.approve")');
    expect(route).toContain('requirePermission(context,"deploy.rollback")');
    expect(portal).toContain('action: z.literal("publish_cms")');
    expect(portal).toContain('action: z.literal("rollback_cms")');
  });
});
