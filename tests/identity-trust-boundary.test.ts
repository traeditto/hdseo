import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("canonical identity trust boundary", () => {
  it("never accepts legacy Sites identity headers on Vercel", () => {
    const auth = read("app/chatgpt-auth.ts");
    expect(auth).toContain("process.env.VERCEL");
    expect(auth).toContain('HDSEO_ENABLE_LEGACY_SITES_IDENTITY !== "true"');
    expect(auth.indexOf("process.env.VERCEL")).toBeLessThan(
      auth.indexOf("requestHeaders.get(USER_EMAIL_HEADER)"),
    );
  });

  it("redirects every non-Vercel portal to the canonical production domain", () => {
    const portal = read("lib/auth/portal-user.ts");
    expect(portal).toContain("https://hdseo.vercel.app/login/${portal}");
    expect(portal).not.toContain("requireChatGPTUser(returnTo)");
    expect(portal).not.toContain("hasSupabaseAdminConfig");
  });

  it("requires an existing active platform-admin record", () => {
    const access = read("lib/auth/portal-access.ts");
    const identity = read("lib/live/identity.ts");
    expect(access).toContain('.from("platform_admins")');
    expect(identity).toContain('.from("platform_admins")');
    expect(access).not.toContain("platformAdminEmails");
    expect(identity).not.toContain("platformAdminEmails");
    expect(identity).not.toContain('.from("platform_admins").upsert');
  });
});
