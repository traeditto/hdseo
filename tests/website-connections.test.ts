import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,expect,it } from "vitest";

import { isPrivateAddress,normalizeSiteUrl } from "../lib/websites/url-security";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("website connections",()=>{
  it("normalizes public HTTPS domains and rejects internal targets",()=>{
    expect(normalizeSiteUrl("www.Example.com/")).toEqual({siteUrl:"https://www.example.com",canonicalDomain:"example.com"});
    for(const address of ["127.0.0.1","10.1.2.3","172.16.2.3","192.168.1.2","::1","fd00::1"])expect(isPrivateAddress(address)).toBe(true);
    expect(()=>normalizeSiteUrl("http://example.com")).toThrow("public HTTPS");
    expect(()=>normalizeSiteUrl("https://127.0.0.1")).toThrow("Private or local");
  });

  it("supports direct providers without requiring a GitHub repository",()=>{
    const service=read("lib/websites/connections.ts");
    expect(service).toContain("/wp-json/wp/v2/users/me?context=edit");
    expect(service).toContain('"X-Shopify-Access-Token"');
    expect(service).toContain("https://api.webflow.com/v2/sites/");
    expect(service).toContain("encryptSecret");
    for(const mode of ["monitor_only","managed_migration","manual"])expect(service).toContain(mode);
    expect(service).toContain('clientMembership.data?.role==="client_admin"');
    expect(service).toContain("Only an agency connection manager or the business owner");
  });

  it("never exposes encrypted website secrets in the agency snapshot",()=>{
    const store=read("lib/live/store.ts");
    expect(store).toContain('.from("cms_connections")');
    const select=store.match(/\.from\("cms_connections"\)[\s\S]{0,300}?\.select\(([^;]+?)\)/)?.[1]??"";
    expect(select).not.toContain("encrypted_secret_reference");
  });

  it("keeps public monitoring separate from verified publishing readiness",()=>{
    const store=read("lib/live/store.ts"),portal=read("app/ui/live-client-dashboard.tsx");
    expect(store).toContain("publishingReady");
    expect(store).toContain("PUBLISHING_ACCESS_REQUIRED");
    expect(store).toContain("github_execution_readiness");
    expect(portal).toContain("Website publishing");
    expect(portal).toContain("Analysis only");
  });

  it("provides a complete non-technical onboarding UI",()=>{
    const ui=read("app/ui/website-connections.tsx"),dashboard=read("app/ui/live-agency-dashboard.tsx");
    for(const label of ["WordPress","Shopify","Webflow","GitHub + Vercel","Another website platform","Monitoring only","HD SEO managed migration"])expect(ui).toContain(label);
    expect(ui).toContain("Application Password");
    expect(ui).toContain("connect_website");
    expect(ui).toContain("Reload authorized properties");
    expect(ui).toContain('method:"PUT"');
    expect(dashboard).toContain('"Websites"');
    expect(dashboard).toContain("WebsiteConnections");
  });

  it("preserves tenant-safe agency and business-owner return paths through GitHub installation",()=>{
    const install=read("app/api/github/install/route.ts"),callback=read("app/api/github/callback/route.ts"),binding=read("lib/github/installation-binding.ts"),context=read("lib/github/integration-context.ts"),portal=read("app/ui/live-client-dashboard.tsx");
    expect(install).toContain('"/portal/agency"');
    expect(install).toContain('"/portal/client"');
    expect(install).toContain("existingInstallationId");
    expect(install).toContain("verify_and_bind");
    expect(callback).toContain('"/portal/agency"');
    expect(callback).toContain('"/portal/client"');
    expect(context).toContain('clientMembership.data?.role !== "client_admin"');
    expect(context).toContain('["trial", "active"]');
    expect(portal).toContain("Connect GitHub repository");
    expect(portal).toContain("I don’t use GitHub—help me connect");
    expect(binding).toContain("upsertGitHubWebsite");
    expect(binding).not.toContain("already assigned to another HD SEO agency");
    expect(read("lib/github/repository-connection.ts")).toContain('onConflict:"agency_id,github_installation_id,github_repository_id"');
    expect(read("supabase/migrations/0039_shared_github_installation_tenants.sql")).toContain("repositories_agency_installation_repository_uidx");
  });

  it("lets a non-technical owner delegate only website setup to a trusted builder",()=>{
    const portal=read("app/ui/live-client-dashboard.tsx"),handoff=read("lib/websites/connection-invites.ts"),page=read("app/ui/website-connection-handoff.tsx"),migration=read("supabase/migrations/0040_website_connection_handoffs.sql");
    expect(portal).toContain("Send setup to the person who built your website");
    expect(portal).toContain("create_website_connection_invite");
    expect(handoff).toContain('randomBytes(32)');
    expect(handoff).toContain('createHash("sha256")');
    expect(handoff).not.toContain("token_hash: token,");
    expect(page).toContain("No billing or client data");
    expect(page).toContain("needsRepositorySelection");
    expect(migration).toContain("website_connection_invites");
    expect(migration).toContain("expires_at");
    expect(migration).toContain("has_client_access");
  });
});
