import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("the production home exposes three role portals",()=>{
  const source=read("app/page.tsx");
  assert.match(source,/key: "admin"/);
  assert.match(source,/key: "agency"/);
  assert.match(source,/key: "client"/);
  assert.match(source,/SECURE PORTAL ACCESS/);
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
