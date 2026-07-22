import {describe,expect,it} from "vitest";

import {providerDeploymentIso,selectPriorProductionDeployment} from "../lib/automation/rollback-baseline";

describe("production rollback baseline selection",()=>{
  it("selects the closest READY production deployment before the current release",()=>{
    const current={id:"current",url:"current.vercel.app",readyState:"READY",target:"production",createdAt:3_000};
    const selected=selectPriorProductionDeployment([
      current,
      {id:"old",url:"old.vercel.app",readyState:"READY",target:"production",createdAt:1_000},
      {id:"prior",url:"prior.vercel.app",readyState:"READY",target:"production",createdAt:2_000},
    ],current);
    expect(selected?.id).toBe("prior");
  });

  it("excludes failed, preview, current, and newer deployments",()=>{
    const current={id:"current",url:"current.vercel.app",readyState:"READY",target:"production",createdAt:3_000};
    expect(selectPriorProductionDeployment([
      current,
      {id:"failed",url:"failed.vercel.app",readyState:"ERROR",target:"production",createdAt:2_900},
      {id:"preview",url:"preview.vercel.app",readyState:"READY",target:"preview",createdAt:2_800},
      {id:"newer",url:"newer.vercel.app",readyState:"READY",target:"production",createdAt:4_000},
    ],current)).toBeNull();
  });

  it("normalizes provider seconds and milliseconds",()=>{
    expect(providerDeploymentIso(1_700_000_000,"fallback")).toBe("2023-11-14T22:13:20.000Z");
    expect(providerDeploymentIso(1_700_000_000_000,"fallback")).toBe("2023-11-14T22:13:20.000Z");
  });
});
