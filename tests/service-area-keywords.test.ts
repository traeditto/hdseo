import { describe, expect, it } from "vitest";
import { discoverKeywordCandidates } from "../lib/seo/keyword-discovery";
import {
  assessKeywordServiceArea,
  buildServiceAreaPolicy,
} from "../lib/seo/service-area";

const policy = buildServiceAreaPolicy({
  primaryMarket: "United States",
  requestedMarket: "United States",
  serviceAreas: [
    {
      id: "jacksonville",
      name: "Jacksonville, Florida",
      city: "Jacksonville",
      state: "Florida",
      priority: 100,
    },
    {
      id: "orange-park",
      name: "Orange Park, Florida",
      city: "Orange Park",
      state: "Florida",
      priority: 90,
    },
  ],
  services: [{ id: "roof-repair", name: "roof repair", priority: 100 }],
});

describe("service-area keyword enforcement", () => {
  it("uses the configured primary service area instead of a nationwide default", () => {
    expect(policy.targetMarket).toBe("Jacksonville, Florida");
    expect(policy.local).toBe(true);
  });

  it("allows geographically explicit demand when the client selects nationwide", () => {
    const nationwide = buildServiceAreaPolicy({
      primaryMarket: "United States",
      marketScope: "nationwide",
      serviceAreas: policy.serviceAreas,
      services: policy.services,
    });
    expect(nationwide).toMatchObject({
      targetMarket: "United States",
      local: false,
      marketScope: "nationwide",
    });
    expect(
      assessKeywordServiceArea("roof repair tampa", nationwide),
    ).toMatchObject({
      allowed: true,
      reasonCodes: ["NATIONWIDE_SCOPE"],
    });
    expect(
      assessKeywordServiceArea("roof repair texas", nationwide).allowed,
    ).toBe(true);
  });

  it("allows generic and in-area searches but excludes explicit out-of-area searches", () => {
    expect(
      assessKeywordServiceArea("emergency roof repair", policy).allowed,
    ).toBe(true);
    expect(
      assessKeywordServiceArea("roof repair jacksonville", policy),
    ).toMatchObject({
      allowed: true,
      locationId: "jacksonville",
      locationRelevance: 100,
    });
    expect(assessKeywordServiceArea("roof repair tampa", policy)).toMatchObject(
      {
        allowed: false,
        reasonCodes: ["OUTSIDE_SERVICE_AREA"],
      },
    );
    expect(assessKeywordServiceArea("roof repair texas", policy).allowed).toBe(
      false,
    );
    expect(assessKeywordServiceArea("roof repair 33101", policy).allowed).toBe(
      false,
    );
    expect(
      assessKeywordServiceArea("roofing companies middleburg fl", policy)
        .allowed,
    ).toBe(false);
  });

  it("filters provider candidates before they can become active opportunities", () => {
    const item = (keyword: string) => ({
      keyword_data: {
        keyword,
        keyword_info: { search_volume: 500, cpc: 20 },
        keyword_properties: { keyword_difficulty: 30 },
        search_intent_info: { main_intent: "commercial" },
      },
    });
    const candidates = discoverKeywordCandidates(
      [
        {
          items: [
            item("roof repair jacksonville"),
            item("roof repair tampa"),
            item("emergency roof repair"),
          ],
        },
      ],
      1500,
      10,
      policy,
    );
    expect(candidates.map((candidate) => candidate.keyword)).toEqual(
      expect.arrayContaining([
        "roof repair jacksonville",
        "emergency roof repair",
      ]),
    );
    expect(candidates.map((candidate) => candidate.keyword)).not.toContain(
      "roof repair tampa",
    );
  });

  it("understands service-area labels, local aliases, and service word families", () => {
    const liveStylePolicy = buildServiceAreaPolicy({
      primaryMarket: "Jacksonville area",
      serviceAreas: [
        {
          id: "jacksonville-area",
          name: "Jacksonville area",
          city: "Jacksonville area",
          priority: 97,
        },
      ],
      services: [
        { id: "replacement", name: "Roof Replacement", priority: 95 },
        { id: "repair", name: "roof repair", priority: 90 },
      ],
    });

    expect(
      assessKeywordServiceArea("roofing companies in jax fl", liveStylePolicy),
    ).toMatchObject({
      allowed: true,
      locationId: "jacksonville-area",
      serviceId: "replacement",
    });
    expect(
      assessKeywordServiceArea("roofing companies jacksonville", liveStylePolicy),
    ).toMatchObject({
      allowed: true,
      locationId: "jacksonville-area",
      serviceId: "replacement",
    });
  });

  it("rejects malformed provider queries before scoring", () => {
    const item = (keyword: string) => ({
      keyword_data: {
        keyword,
        keyword_info: { search_volume: 500, cpc: 20 },
        keyword_properties: { keyword_difficulty: 30 },
        search_intent_info: { main_intent: "commercial" },
      },
    });
    const candidates = discoverKeywordCandidates(
      [
        {
          items: [
            item("roof roofing company"),
            item("flat roof roofing companies"),
            item("roof repair jacksonville"),
          ],
        },
      ],
      1500,
      10,
      policy,
    );
    expect(candidates.map((candidate) => candidate.keyword)).toEqual([
      "roof repair jacksonville",
    ]);
  });
});
