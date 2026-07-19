import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("the production home presents the HD SEO marketing experience",()=>{
  const page=read("app/page.tsx"),source=read("app/marketing-home.tsx");
  assert.match(page,/SoftwareApplication/);
  assert.match(page,/FAQPage/);
  assert.match(source,/AUTONOMOUS SEO, ACCOUNTABLE RESULTS/);
  assert.match(source,/Turn SEO into a/);
  assert.match(source,/href="\/login\/client"/);
  assert.match(source,/href="\/login\/agency"/);
  assert.match(source,/href="\/audit"/);
  assert.doesNotMatch(source,/codex-preview|react-loading-skeleton/);
});

test("the agency login uses live verified identity without a demo fallback",()=>{
  const source=read("app/ui/portal-login.tsx");
  assert.match(source,/Sign in to \$\{copy\.title\}/);
  assert.match(source,/Continue with ChatGPT/);
  assert.match(source,/\/api\/auth\/portal-access/);
  assert.doesNotMatch(source,/Preview \{copy\.title\}/);
});

test("Admin, Agency, and Client production portals are distinct and protected",()=>{
  const admin=read("app/portal/admin/page.tsx"),agency=read("app/portal/agency/page.tsx"),client=read("app/portal/client/page.tsx");
  assert.match(admin,/LiveAdminDashboard/);
  assert.match(agency,/LiveAgencyDashboard/);
  assert.match(client,/LiveClientBusinessDashboard/);
  for(const source of [admin,agency,client])assert.match(source,/requirePortalUser/);
});
