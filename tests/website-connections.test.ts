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
  });

  it("never exposes encrypted website secrets in the agency snapshot",()=>{
    const store=read("lib/live/store.ts");
    expect(store).toContain('.from("cms_connections")');
    const select=store.match(/\.from\("cms_connections"\)[\s\S]{0,300}?\.select\(([^;]+?)\)/)?.[1]??"";
    expect(select).not.toContain("encrypted_secret_reference");
  });

  it("provides a complete non-technical onboarding UI",()=>{
    const ui=read("app/ui/website-connections.tsx"),dashboard=read("app/ui/live-agency-dashboard.tsx");
    for(const label of ["WordPress","Shopify","Webflow","GitHub + Vercel","Another website platform","Monitoring only","HD SEO managed migration"])expect(ui).toContain(label);
    expect(ui).toContain("Application Password");
    expect(ui).toContain("connect_website");
    expect(dashboard).toContain('"Websites"');
    expect(dashboard).toContain("WebsiteConnections");
  });

  it("preserves the agency workspace return path through GitHub installation",()=>{
    const install=read("app/api/github/install/route.ts"),callback=read("app/api/github/callback/route.ts"),binding=read("lib/github/installation-binding.ts");
    expect(install).toContain('"/portal/agency"');
    expect(callback).toContain('"/portal/agency"');
    expect(binding).toContain("upsertGitHubWebsite");
  });
});
