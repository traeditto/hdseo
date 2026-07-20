import {describe,expect,it} from "vitest";
import {scanGeneratedDiff} from "../lib/safety/generated-diff-scanner";

describe("generated diff scanner",()=>{
  it("accepts a bounded SEO page change",()=>expect(scanGeneratedDiff([{path:"app/services/roofing/page.tsx",content:"export default function Page(){return <main>Roof repair</main>}"}]).passed).toBe(true));
  it("blocks workflow and secret mutations",()=>expect(()=>scanGeneratedDiff([{path:".github/workflows/release.yml",content:`token: ${["sk","live","abcdefghijklmnop"].join("_")}`}])).toThrow());
  it("blocks process execution in generated code",()=>expect(()=>scanGeneratedDiff([{path:"app/page.ts",content:'import {exec} from "node:child_process"'}])).toThrow());
});
