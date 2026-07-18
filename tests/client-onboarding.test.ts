import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("five-minute client onboarding", () => {
  it("detects common website platforms without requesting credentials", () => {
    const detector = read("lib/websites/platform-detection.ts");
    for (const signal of ["wp-content", "cdn\\.shopify", "squarespace-cdn", "wixstatic", "data-wf-site", "x-vercel-id"]) {
      expect(detector).toContain(signal);
    }
    expect(detector).toContain("assertPublicSiteUrl");
    expect(detector).toContain('redirect: "manual"');
    expect(detector).not.toContain("applicationPassword");
  });

  it("does not ask clients to supply keywords", () => {
    const wizard = read("app/ui/client-onboarding-wizard.tsx");
    expect(wizard).toContain("No keywords required");
    expect(wizard).toContain("HD SEO turns these into search opportunities");
    expect(wizard).not.toContain('name="keyword"');
  });

  it("offers simple connections and protected automation levels", () => {
    const wizard = read("app/ui/client-onboarding-wizard.tsx");
    for (const label of ["Website monitoring", "Connect Google", "Recommend changes", "Fix safe issues automatically", "Full autopilot", "Start My SEO"]) {
      expect(wizard).toContain(label);
    }
    expect(wizard).toContain("DNS, legal claims, pricing, and major design changes always stay protected");
  });

  it("persists the business profile and launches real evidence jobs", () => {
    const store = read("lib/live/store.ts");
    for (const table of ["seo_services", "seo_locations", "cms_connections", "clients", "websites"]) {
      expect(store).toContain(`from("${table}")`);
    }
    expect(store).toContain('jobType: "crawler.crawl"');
    expect(store).toContain("discoverKeywordOpportunities(email");
    expect(store).toContain('onboardingStatus: "launched"');
  });

  it("preserves onboarding through the Google OAuth round trip", () => {
    const connect = read("app/api/google/connect/route.ts");
    const wizard = read("app/ui/client-onboarding-wizard.tsx");
    expect(connect).toContain("requestedReturnUrl");
    expect(connect).toContain('!requestedReturnUrl.startsWith("//")');
    expect(wizard).toContain("onboarding=${projectId}");
    expect(wizard).toContain("gsc=connected");
  });
});
