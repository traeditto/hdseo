import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const apiRoot = join(root, "app", "api");

function routeFiles(directory = apiRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? routeFiles(path)
      : entry === "route.ts"
        ? [path]
        : [];
  });
}

const authenticationMarkers = [
  "resolveClientContext",
  "resolveTenantContext",
  "requireLiveAgencyProject",
  "requireLiveAgency",
  "resolveGitHubManagementContext",
  "resolvePortalAccess",
  "getChatGPTUser",
];

const callbackMarkers = [
  "verifyIntegrationState",
  "consumeIntegrationState",
  "integration_oauth_states",
];

const webhookMarkers = [
  "verifyWebhookSignature",
  "claimWebhookEvent",
  "timingSafeEqual",
  "export { POST } from",
];

const delegatedSetupMarkers = [
  "inspectWebsiteConnectionInvite",
  "completeWebsiteConnectionInvite",
  "selectWebsiteInviteRepository",
  "resolveWebsiteConnectionInviteForGitHub",
];

function hasAny(source: string, markers: string[]) {
  return markers.some((marker) => source.includes(marker));
}

describe("complete API security surface", () => {
  it("classifies every API route behind authentication, a signed callback, a verified webhook, cron authorization, or an explicitly bounded public flow", () => {
    const unclassified = routeFiles().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const name = relative(root, file);
      const authenticated = hasAny(source, authenticationMarkers);
      const signedCallback = hasAny(source, callbackMarkers);
      const verifiedWebhook = hasAny(source, webhookMarkers);
      const guardedCron = source.includes("guardWorkerCron");
      const delegatedSetup = hasAny(source, delegatedSetupMarkers);
      const publicAudit = name === "app/api/public/audit/route.ts" &&
        source.includes("enforceRateLimit") &&
        source.includes("crawlSite");
      const canonicalAlias = /export \{\s*(?:GET|POST)\s*\} from/.test(source);
      return authenticated || signedCallback || verifiedWebhook || guardedCron || delegatedSetup || publicAudit || canonicalAlias
        ? []
        : [name];
    });
    expect(unclassified).toEqual([]);
  });

  it("validates every JSON mutation before using request data", () => {
    const exempt = new Set([
      "app/api/agency-billing/portal/route.ts",
      "app/api/auth/signout/route.ts",
      "app/api/creatives/proof-upload/route.ts",
      "app/api/github/webhook/route.ts",
      "app/api/vercel/webhook/route.ts",
      "app/api/webhooks/attribution/[provider]/route.ts",
      "app/api/webhooks/github/route.ts",
      "app/api/webhooks/vercel/route.ts",
    ]);
    const invalid = routeFiles().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const name = relative(root, file);
      if (!/export async function (?:POST|PUT|PATCH|DELETE)/.test(source) || exempt.has(name)) return [];
      return source.includes("parseJson") ||
        source.includes("schema.parse") ||
        source.includes("safeParse") ||
        source.includes("request.text()") ||
        source.includes("request.formData") ||
        /export \{\s*POST\s*\} from/.test(source)
        ? []
        : [name];
    });
    expect(invalid).toEqual([]);
  });

  it("keeps all worker entry points authorization guarded", () => {
    for (const path of [
      "app/api/cron/seo/route.ts",
      "app/api/cron/automation/route.ts",
      "app/api/cron/agent-service/route.ts",
    ]) {
      const source = readFileSync(join(root, path), "utf8");
      expect(source).toContain("guardWorkerCron(request)");
    }
  });
});
