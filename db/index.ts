import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type RuntimeEnvironment={DB?:D1Database};
declare global { var __HD_SEO_RUNTIME_ENV__:RuntimeEnvironment|undefined; }
export function setRuntimeEnvironment(runtime:RuntimeEnvironment){globalThis.__HD_SEO_RUNTIME_ENV__=runtime;}
export function getD1Binding(){const binding=globalThis.__HD_SEO_RUNTIME_ENV__?.DB;if(!binding)throw new Error("Cloudflare D1 binding `DB` is unavailable in this runtime.");return binding;}
export function getDb() {
  return drizzle(getD1Binding(), { schema });
}
