import { describe, expect, it } from "vitest";

import {
  buildImplementationOptions,
  type ImplementationReadiness,
} from "../lib/seo/implementation-options";

function readiness(
  overrides: Partial<ImplementationReadiness> = {},
): ImplementationReadiness {
  return {
    projectId: "project-1",
    cmsProvider: null,
    cmsReady: false,
    repositoryConnected: false,
    repositoryReady: false,
    repositoryBlockers: ["REPOSITORY_NOT_VERIFIED"],
    vercelConnected: false,
    ...overrides,
  };
}

describe("connection-aware implementation choices", () => {
  it("recommends verified WordPress publishing and keeps other paths visible", () => {
    const options = buildImplementationOptions(
      readiness({ cmsProvider: "wordpress", cmsReady: true }),
      { cmsType: "wordpress" },
    );

    expect(options).toHaveLength(10);
    expect(options.find((item) => item.value === "wordpress_direct")).toMatchObject(
      { available: true, recommended: true },
    );
    expect(options.find((item) => item.value === "shopify_direct")).toMatchObject(
      { available: false, setup: true },
    );
    expect(options.find((item) => item.value === "developer_ticket")?.available).toBe(true);
  });

  it("recommends GitHub and Vercel when both connections pass the safety gates", () => {
    const options = buildImplementationOptions(
      readiness({
        repositoryConnected: true,
        repositoryReady: true,
        repositoryBlockers: [],
        vercelConnected: true,
      }),
      { cmsType: "github" },
    );

    expect(options.find((item) => item.value === "repository_vercel")).toMatchObject(
      { available: true, recommended: true },
    );
    expect(options.find((item) => item.value === "repository_pr")?.available).toBe(true);
  });

  it("recognizes an existing GitHub connection and asks only for safety activation", () => {
    const options = buildImplementationOptions(
      readiness({
        repositoryConnected: true,
        repositoryBlockers: [
          "PROJECT_FEATURE_DISABLED",
          "MANUAL_WORKFLOW_NOT_VERIFIED",
        ],
      }),
      { cmsType: "github" },
    );
    const repository = options.find((item) => item.value === "repository_pr");

    expect(repository).toMatchObject({
      available: false,
      setup: true,
      connected: true,
      setupLabel: "Finish safety activation",
    });
    expect(repository?.reason).toContain("GitHub is already connected");
    expect(repository?.reason).toContain("does not need to be connected again");
    expect(options.find((item) => item.value === "generic_cms")?.recommended).toBe(true);
  });

  it("recommends guided Squarespace instructions when that platform is detected", () => {
    const options = buildImplementationOptions(readiness(), {
      cmsType: "squarespace",
    });
    expect(options.find((item) => item.value === "squarespace_guided")).toMatchObject(
      { available: true, recommended: true },
    );
  });
});
