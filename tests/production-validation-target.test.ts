import { describe, expect, it } from "vitest";
import {
  isGeneratedVercelHostname,
  productionValidationCandidates,
  verifiedProviderHostnames,
} from "../lib/automation/validation-target";

describe("production validation target selection", () => {
  it("prefers the customer canonical domain over generated Vercel deployment URLs", () => {
    expect(productionValidationCandidates({
      canonicalDomain: "kingdomroofingco.com",
      projectDomain: "www.kingdomroofingco.com",
      providerDomains: [
        { name: "kingdom-roofing-website1-czoa1fsar.vercel.app", verified: true },
        { name: "www.kingdomroofingco.com", verified: true },
      ],
    })).toEqual([
      { baseUrl: "https://kingdomroofingco.com", hostname: "kingdomroofingco.com", source: "canonical_domain" },
      { baseUrl: "https://www.kingdomroofingco.com", hostname: "www.kingdomroofingco.com", source: "project_domain" },
    ]);
  });

  it("uses a verified custom Vercel domain when onboarding lacks a canonical domain", () => {
    expect(productionValidationCandidates({
      providerDomains: [
        { name: "preview-123.vercel.app", verified: true },
        { name: "customer.example", verified: true },
        { name: "unverified.example", verified: false },
      ],
    })).toEqual([
      { baseUrl: "https://customer.example", hostname: "customer.example", source: "verified_vercel_domain" },
    ]);
  });

  it("never treats generated, malformed, or local hostnames as public production websites", () => {
    expect(isGeneratedVercelHostname("https://project.vercel.app/path")).toBe(true);
    expect(productionValidationCandidates({
      canonicalDomain: "localhost:3000",
      projectDomain: "not a domain",
      configuredDomains: ["project.vercel.app"],
    })).toEqual([]);
    expect(productionValidationCandidates({canonicalDomain:"127.0.0.1"})).toEqual([]);
    expect(productionValidationCandidates({canonicalDomain:"169.254.169.254"})).toEqual([]);
    expect(productionValidationCandidates({canonicalDomain:"[::1]"})).toEqual([]);
  });

  it("deduplicates provider domains and excludes unverified names from synchronization", () => {
    expect(verifiedProviderHostnames([
      { name: "Example.com", verified: true },
      { name: "https://example.com/path", verified: true },
      { name: "pending.example", verified: false },
    ])).toEqual(["example.com"]);
  });
});
