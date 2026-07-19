import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("the production home presents the HD SEO marketing experience",()=>{
  const page=read("app/page.tsx"),source=read("app/marketing-home.tsx"),shared=read("app/marketing-shared.tsx");
  assert.match(page,/SoftwareApplication/);
  assert.match(page,/FAQPage/);
  assert.match(source,/Find the highest-value SEO improvement/);
  assert.match(source,/Get My Free 25-Page SEO Audit/);
  assert.match(source,/No credit card required/);
  assert.match(source,/UNVERIFIED/);
  assert.match(shared,/href="\/login\/client"/);
  assert.match(source,/href="\/agencies"/);
  assert.match(source,/href="\/audit"/);
  assert.doesNotMatch(source+shared,/mailto:|Start My SEO Plan|>Pricing</);
  assert.doesNotMatch(source,/codex-preview|react-loading-skeleton/);
});

test("the conversion routes have specific metadata and honest placeholders",()=>{
  const audit=read("app/audit/page.tsx"),form=read("app/audit/audit-experience.tsx"),privacy=read("app/privacy/page.tsx"),terms=read("app/terms/page.tsx"),booking=read("app/book-demo/page.tsx");
  assert.match(audit,/canonical: "\/audit"/);
  assert.match(audit,/Free 25-Page SEO Audit/);
  assert.match(form,/type="url"/);
  assert.match(form,/autoComplete="url"/);
  assert.match(form,/audit_form_start/);
  assert.match(form,/audit_form_submit/);
  assert.match(privacy,/canonical: "\/privacy"/);
  assert.match(terms,/canonical: "\/terms"/);
  assert.match(booking,/Booking placeholder/);
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
