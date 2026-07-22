import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");

describe("central browser mutation origin boundary", () => {
  it("guards every API route and rejects missing, cross-site and mismatched origins", () => {
    expect(source).toContain('matcher: "/api/:path*"');
    expect(source).toContain('request.headers.get("origin")');
    expect(source).toContain('request.headers.get("sec-fetch-site")');
    expect(source).toContain('fetchSite === "cross-site"');
    expect(source).toContain("parsedOrigin.origin !== request.nextUrl.origin");
    expect(source).toContain('code: "INVALID_ORIGIN"');
  });

  it("exempts only the separately signed provider webhook endpoints", () => {
    for (const endpoint of [
      "/api/github/webhook",
      "/api/vercel/webhook",
      "/api/webhooks/github",
      "/api/webhooks/vercel",
      "/api/webhooks/attribution/",
      "/api/billing/webhook",
    ]) {
      expect(source).toContain(endpoint);
    }
    expect(source).not.toContain("/api/cron/");
    expect(source).not.toContain("/api/public/audit");
  });
});
