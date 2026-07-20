import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("the production home presents the HD SEO marketing experience",()=>{
  const page=read("app/page.tsx"),source=read("app/marketing-home.tsx"),shared=read("app/marketing-shared.tsx");
  assert.match(page,/SoftwareApplication/);
  assert.match(page,/FAQPage/);
  assert.match(source,/Find the highest-value SEO improvement/);
  assert.match(source,/Start My Free Trial/);
  assert.match(source,/No credit card required/);
  assert.match(source,/UNVERIFIED/);
  assert.match(shared,/href="\/login"/);
  assert.match(source+shared,/href="\/agencies"/);
  assert.match(source,/href="\/audit"/);
  assert.match(source+shared,/href="\/register"/);
  assert.match(shared,/href="\/pricing"/);
  assert.match(source,/business_plan_selection/);
  assert.doesNotMatch(source+shared,/mailto:|Start My SEO Plan/);
  assert.doesNotMatch(source,/codex-preview|react-loading-skeleton/);
});

test("the pricing experience uses one structured catalog and approval-safe commercial language",()=>{
  const page=read("app/pricing/page.tsx"),experience=read("app/pricing/pricing-experience.tsx"),catalog=read("app/pricing-catalog.ts");
  assert.match(page,/canonical: "\/pricing"/);
  assert.match(page,/"@type": "Product"/);
  assert.match(catalog,/monthly: 199/);
  assert.match(catalog,/annual: 1990/);
  assert.match(catalog,/monthly: 1999/);
  assert.match(experience,/Annual — 2 months free/);
  assert.match(experience,/Subscription pricing covers the HD SEO platform and included agent work/);
  assert.match(experience,/Market ranges are illustrative/);
  assert.match(experience,/planning math is not a forecast/);
  assert.match(experience,/pricing_audience_toggle/);
  assert.match(experience,/pricing_billing_toggle/);
  assert.match(experience,/pricing-mobile-cta/);
  assert.match(experience,/How do you want to work\?/);
  assert.match(experience,/GUIDE ME/);
  assert.match(experience,/RUN IT FOR ME/);
  assert.match(experience,/Agent service does not mean unrestricted automation/);
  assert.match(experience,/never purchased without approval/);
  assert.match(catalog,/HD SEO Autopilot/);
  assert.match(catalog,/monthly: 1299/);
  assert.match(catalog,/annual: 12990/);
  assert.match(catalog,/White-Label Agent Team/);
  assert.match(catalog,/monthly: 3999/);
  assert.doesNotMatch(experience+catalog,/\bAaaS\b/);
  assert.doesNotMatch(experience,/guaranteed revenue|guaranteed rankings/i);
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
  const source=read("app/ui/portal-login.tsx"),selector=read("app/ui/portal-role-selector.tsx"),hub=read("app/login/page.tsx");
  assert.match(source,/Sign in to \$\{copy\.title\}/);
  assert.match(source,/Continue with ChatGPT/);
  assert.match(source,/\/api\/auth\/portal-access/);
  assert.match(source,/href="\/login"/);
  assert.match(selector,/Admin/);
  assert.match(selector,/Agency/);
  assert.match(selector,/Business Owner/);
  assert.match(hub,/portalRoles\.map/);
  assert.doesNotMatch(source,/Preview \{copy\.title\}/);
});

test("Admin, Agency, and Client production portals are distinct and protected",()=>{
  const admin=read("app/portal/admin/page.tsx"),agency=read("app/portal/agency/page.tsx"),client=read("app/portal/client/page.tsx");
  assert.match(admin,/LiveAdminDashboard/);
  assert.match(agency,/LiveAgencyDashboard/);
  assert.match(client,/LiveClientBusinessDashboard/);
  for(const source of [admin,agency,client])assert.match(source,/requirePortalUser/);
});
