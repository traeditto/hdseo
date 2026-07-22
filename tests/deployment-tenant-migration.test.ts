import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const sql=readFileSync("supabase/migrations/0046_deployment_tenant_reconciliation.sql","utf8");

describe("deployment tenant reconciliation migration",()=>{
  it("adds, backfills, and requires the deployment tenant key",()=>{
    expect(sql).toContain("add column if not exists client_organization_id uuid");
    expect(sql).toContain("set client_organization_id = c.organization_id");
    expect(sql).toContain("DEPLOYMENT_TENANT_BACKFILL_INCOMPLETE");
    expect(sql).toContain("alter column client_organization_id set not null");
  });

  it("enforces project-scoped tenant integrity before reconciliation runs",()=>{
    expect(sql).toContain("foreign key(agency_id,client_organization_id,project_id)");
    expect(sql).toContain("references public.seo_projects(agency_id,client_organization_id,id)");
    expect(sql).toContain("validate constraint deployments_project_tenant_0046_fk");
  });
});
