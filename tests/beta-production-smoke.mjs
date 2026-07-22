import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const origin = (process.env.HDSEO_ACCEPTANCE_ORIGIN || "https://hdseo.vercel.app").replace(/\/+$/, "");
const requestTimeoutMs = Number(process.env.HDSEO_REQUEST_TIMEOUT_MS || 30_000);
const root = resolve(process.cwd());
const apiRoot = join(root, "app", "api");
const uuid = "00000000-0000-4000-8000-000000000001";
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function routeFiles(directory = apiRoot) {
  return readdirSync(directory).flatMap((entry) => {
    const file = join(directory, entry);
    return statSync(file).isDirectory()
      ? routeFiles(file)
      : entry === "route.ts"
        ? [file]
        : [];
  });
}

function routePath(file) {
  return `/${relative(root, file)}`
    .replace(/^\/app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[provider\]/g, "hubspot")
    .replace(/\[operation\]/g, "clients")
    .replace(/\[token\]/g, "invalid-invite-token")
    .replace(/\[(?:executionId|packageId|jobId|id)\]/g, uuid);
}

function routeMethods(source) {
  const methods = new Set();
  for (const match of source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(match[1]);
  for (const match of source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      if (new RegExp(`\\b${method}\\b`).test(match[1])) methods.add(method);
    }
  }
  return [...methods];
}

function requestUrl(path) {
  const url = new URL(path, `${origin}/`);
  for (const [key, value] of Object.entries({
    agencyId: uuid,
    clientId: uuid,
    projectId: uuid,
    deploymentId: uuid,
    packageId: uuid,
    provider: "google_analytics",
    returnUrl: "/portal/agency",
  })) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url;
}

async function request(path, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(requestUrl(path), {
      method,
      redirect: "manual",
      cache: "no-store",
      headers: {
        "user-agent": "HDSEOBetaSurfaceAcceptance/1.0",
        accept: "application/json, text/plain, */*",
        ...(unsafeMethods.has(method)
          ? {
              "content-type": "application/json",
              origin,
              "sec-fetch-site": "same-origin",
              "idempotency-key": `beta-surface-${method.toLowerCase()}-${crypto.randomUUID()}`,
            }
          : {}),
      },
      ...(unsafeMethods.has(method) && method !== "DELETE" ? { body: "{}" } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function assertSafeBody(text, label) {
  assert.doesNotMatch(text, /Internal Server Error|Application error|FUNCTION_INVOCATION_FAILED|MIDDLEWARE_INVOCATION_FAILED/i, `${label} exposed a platform error`);
  assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.|(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{16,}/, `${label} exposed secret-shaped data`);
}

async function main() {
  const routes = routeFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return routeMethods(source).map((method) => ({ file: relative(root, file), path: routePath(file), method }));
  });
  assert.ok(routes.length >= 80, `Expected the complete API surface, found only ${routes.length} methods`);

  const failures = [];
  for (const route of routes) {
    const label = `${route.method} ${route.path}`;
    try {
      const response = await request(route.path, route.method);
      const text = await response.text();
      assert.ok(response.status < 500, `${label} returned ${response.status}: ${text.slice(0, 240)}`);
      assertSafeBody(text, label);
      if (response.status >= 400 && (response.headers.get("content-type") || "").includes("application/json")) {
        const payload = JSON.parse(text);
        assert.notEqual(payload?.ok, true, `${label} accepted a deliberately invalid or unauthenticated request`);
      }
      console.log(`PASS ${label} -> ${response.status}`);
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`FAIL ${label}`);
    }
  }

  assert.equal(failures.length, 0, `Beta API surface failed:\n- ${failures.join("\n- ")}`);
  console.log(`Beta API surface passed across ${routes.length} live route methods.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
