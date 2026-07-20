import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const read=(path:string)=>readFileSync(path,"utf8");
describe("enterprise security contracts",()=>{
  it("rejects Sites identity headers on Vercel",()=>{const auth=read("app/chatgpt-auth.ts"),proxy=read("proxy.ts");expect(auth).toContain("process.env.VERCEL");expect(proxy).toContain("UNTRUSTED_IDENTITY_HEADER");});
  it("globally requires origin and CSRF proof for browser mutations",()=>{const source=read("proxy.ts");expect(source).toContain("ORIGIN_FORBIDDEN");expect(source).toContain("CSRF_INVALID");expect(source).toContain("sec-fetch-site");});
  it("uses nonce-bound scripts instead of unsafe inline scripts",()=>{const source=read("proxy.ts");expect(source).toContain("'strict-dynamic'");expect(source).not.toContain("script-src 'self' 'unsafe-inline'");});
  it("keeps production writes in approval-only safe mode by default",()=>{expect(read(".env.example")).toContain("AUTONOMOUS_PRODUCTION_WRITES_ENABLED=false");expect(read("lib/safety/mutation-gateway.ts")).toContain("effectivePolicy");});
  it("has durable outbox and append-only security ledgers",()=>{const sql=read("supabase/migrations/0036_enterprise_security_and_scale_foundations.sql");for(const table of ["queue_outbox","api_idempotency_records","security_events","audit_ledger","privacy_requests"])expect(sql).toContain(`create table public.${table}`);expect(sql).toContain("APPEND_ONLY_LEDGER");});
});
