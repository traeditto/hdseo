import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the three role login hub", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /HD SEO/);
  assert.match(html, /Admin<br\/>Portal/);
  assert.match(html, /Agency<br\/>Portal/);
  assert.match(html, /Client<br\/>Portal/);
  assert.match(html, /SECURE PORTAL ACCESS/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("server-renders a secure agency login",async()=>{const response=await render("/login/agency");assert.equal(response.status,200);const html=await response.text();assert.match(html,/Sign in to Agency Portal/);assert.match(html,/Preview[\s\S]*Agency Portal/);});

test("server-renders distinct Admin and Client previews",async()=>{const admin=await render("/portal/admin/preview"),client=await render("/portal/client/preview");assert.equal(admin.status,200);assert.equal(client.status,200);assert.match(await admin.text(),/Platform overview/);assert.match(await client.text(),/YOUR SEO PERFORMANCE/);});
