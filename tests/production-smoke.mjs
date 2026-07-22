import assert from "node:assert/strict";

const origin = (process.env.HDSEO_ACCEPTANCE_ORIGIN || "https://hdseo.vercel.app").replace(/\/+$/, "");
const expectedRelease = process.env.HDSEO_EXPECTED_RELEASE?.trim();
const releaseWaitMs = Number(process.env.HDSEO_RELEASE_WAIT_MS || 10 * 60 * 1000);
const requestTimeoutMs = Number(process.env.HDSEO_REQUEST_TIMEOUT_MS || 30_000);

function requestUrl(path) {
  return new URL(path, `${origin}/`).toString();
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(requestUrl(path), {
      redirect: "manual",
      cache: "no-store",
      ...options,
      headers: {
        "user-agent": "HDSEOProductionAcceptance/1.0",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function body(response) {
  const value = await response.text();
  assert.ok(value.length > 0, `Expected a response body from ${response.url}`);
  assert.doesNotMatch(value, /Internal Server Error|Application error|FUNCTION_INVOCATION_FAILED|MIDDLEWARE_INVOCATION_FAILED/i);
  return value;
}

async function waitForRelease() {
  if (!expectedRelease) return;
  const deadline = Date.now() + releaseWaitMs;
  let observed = "missing";
  while (Date.now() < deadline) {
    const response = await request("/");
    observed = response.headers.get("x-hdseo-release-sha") || "missing";
    if (response.status === 200 && observed === expectedRelease) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000));
  }
  assert.equal(observed, expectedRelease, `Production did not serve expected release ${expectedRelease}`);
}

const publicPages = [
  ["/", "HD SEO"],
  ["/pricing", "How do you want to work?"],
  ["/agencies", "One accountable workspace for every client"],
  ["/enterprise", "Scale the workflow without losing control"],
  ["/audit", "Get My Free 25-Page SEO Audit"],
  ["/book-demo", "HD SEO pilot"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
  ["/login", "Three portals"],
  ["/login/admin", "Admin Portal"],
  ["/login/agency", "Agency Portal"],
  ["/login/client", "Business Owner Portal"],
  ["/register", "Create your free business account"],
  ["/reset-password?portal=client", "Choose a new password"],
];

const protectedPortals = [
  ["/portal/admin", "/login/admin"],
  ["/portal/agency", "/login/agency"],
  ["/portal/client", "/login/client"],
];

const unsignedWebhooks = [
  "/api/github/webhook",
  "/api/vercel/webhook",
  "/api/webhooks/github",
  "/api/webhooks/vercel",
  "/api/billing/webhook",
];

async function expectJsonError(response, expectedStatuses) {
  assert.ok(expectedStatuses.includes(response.status), `Unexpected ${response.status} from ${response.url}`);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(typeof payload.error?.code, "string");
  assert.equal(typeof payload.error?.referenceId, "string");
  assert.ok(!JSON.stringify(payload).match(/private.?key|webhook.?secret|access.?token|service.?role/i));
}

async function main() {
  await waitForRelease();
  const failures = [];
  async function check(name, operation) {
    try {
      await operation();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`FAIL ${name}`);
    }
  }

  for (const [path, phrase] of publicPages) {
    await check(`public page ${path}`, async () => {
      const response = await request(path);
      assert.equal(response.status, 200, `${path} did not render successfully`);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      assert.match(await body(response), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    });
  }

  await check("security headers", async () => {
    const home = await request("/");
    assert.match(home.headers.get("strict-transport-security") || "", /max-age=63072000/);
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.match(home.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    if (expectedRelease) assert.equal(home.headers.get("x-hdseo-release-sha"), expectedRelease);
  });

  for (const [path, destination] of protectedPortals) {
    await check(`protected portal ${path}`, async () => {
      const response = await request(path);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path} must redirect unauthenticated visitors`);
      const location = response.headers.get("location") || "";
      assert.ok(new URL(location, origin).pathname.startsWith(destination), `${path} redirected to ${location}`);
    });
  }

  for (const path of ["/api/cron/seo", "/api/cron/automation", "/api/cron/agent-service"]) {
    await check(`cron protection ${path}`, async () => {
      const response = await request(path);
      assert.equal(response.status, 401, `${path} accepted an unsigned scheduler request`);
    });
  }

  for (const path of unsignedWebhooks) {
    await check(`webhook protection ${path}`, async () => {
      const response = await request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.ok([401, 503].includes(response.status), `${path} accepted an unsigned webhook`);
      const payload = await response.json();
      assert.equal(payload.ok, false);
    });
  }

  await check("malformed portal request", async () => {
    const malformedPortal = await request("/api/auth/portal-access", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{",
    });
    await expectJsonError(malformedPortal, [400]);
  });

  const uuid = "00000000-0000-4000-8000-000000000001";
  const unauthenticatedRequests = [
    ["/api/agent-service/status?projectId=" + uuid, { method: "GET" }],
    ["/api/system/readiness?projectId=" + uuid, { method: "GET" }],
    ["/api/github/install?agencyId=" + uuid + "&projectId=" + uuid, { method: "GET" }],
    ["/api/google/connect?projectId=" + uuid, { method: "GET" }],
    ["/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ projectId: uuid, planKey: "starter" }) }],
    ["/api/agency-billing/checkout", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ planKey: "launch" }) }],
    ["/api/work-receipts?projectId=" + uuid + "&packageId=" + uuid, { method: "GET" }],
  ];
  for (const [path, options] of unauthenticatedRequests) {
    await check(`authentication boundary ${path}`, async () => {
      const response = await request(path, options);
      await expectJsonError(response, [401, 403]);
    });
  }

  await check("public audit SSRF boundary", async () => {
    const privateAudit = await request("/api/public/audit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10", origin },
      body: JSON.stringify({ website: "https://127.0.0.1" }),
    });
    await expectJsonError(privateAudit, [400]);
  });

  await check("cross-origin browser mutation boundary", async () => {
    const forgedMutation = await request("/api/public/audit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ website: "https://example.com" }),
    });
    const forgedMutationCopy = forgedMutation.clone();
    await expectJsonError(forgedMutation, [403]);
    const payload = await forgedMutationCopy.json().catch(() => null);
    if (payload) assert.equal(payload.error?.code, "INVALID_ORIGIN");
  });

  await check("invalid website setup handoff", async () => {
    const expiredInvite = await request("/api/website-connection-invites/not-a-valid-token");
    await expectJsonError(expiredInvite, [400, 404, 410]);
  });

  if (failures.length) throw new Error(`Production acceptance failed:\n- ${failures.join("\n- ")}`);
  console.log(`Production acceptance passed for ${origin}${expectedRelease ? ` at ${expectedRelease}` : ""}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
