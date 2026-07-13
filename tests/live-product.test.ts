import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");
describe("live HD SEO product",()=>{
  it("uses Supabase-backed durable storage for the live portal",()=>{const store=read("lib/live/store.ts");expect(store).toContain('from "@/lib/live/identity"');expect(store).toContain("getLiveAdminClient");for(const table of ["client_organizations","seo_projects","seo_opportunities","seo_tasks","implementation_packages","proof_of_work_events"])expect(store).toContain(table);const identity=read("lib/live/identity.ts");expect(identity).toContain("auth.admin");expect(identity).toContain("platform_admins");});
  it("protects every real portal with verified ChatGPT identity",()=>{for(const portal of ["admin","agency","client"])expect(read(`app/portal/${portal}/page.tsx`)).toContain("requireChatGPTUser");});
  it("removes demo and password fallbacks from production login",()=>{const login=read("app/ui/portal-login.tsx");expect(login).toContain("Continue with ChatGPT");expect(login).not.toContain("Preview portal");expect(login).not.toContain("signInWithPassword");});
  it("keeps live writes server-authorized and tenant-scoped",()=>{const route=read("app/api/live/route.ts");expect(route).toContain("getChatGPTUser");const store=read("lib/live/store.ts");expect(store).toContain("requireAgency");expect(store).toContain('.eq("agency_id", agencyId)');expect(store).toContain("Client approval access denied");});
  it("supports Vercel without loading Cloudflare virtual modules",()=>{const vercel=JSON.parse(read("vercel.json")),database=read("db/index.ts");expect(vercel.buildCommand).toBe("pnpm run build:vercel");expect(database).not.toContain('from "cloudflare:workers"');expect(read("package.json")).toContain('"build:vercel": "next build"');});
  it("routes Vercel portal traffic to the primary persistent deployment",()=>{for(const portal of ["admin","agency","client"]){const source=read(`app/portal/${portal}/page.tsx`);expect(source).toContain("process.env.VERCEL");expect(source).toContain("HD_SEO_LIVE_ORIGIN");}});
});
