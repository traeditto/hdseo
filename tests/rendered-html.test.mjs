import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the agency command center", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /HD SEO/);
  assert.match(html, /Next best actions/i);
  assert.match(html, /DEMO DATA/);
  assert.match(html, /Site audits/);
  assert.match(html, /Integrations/);
  assert.match(html, /Add client/);
  assert.match(html, /Create implementation draft/);
  assert.match(html, /Help &amp; support/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
