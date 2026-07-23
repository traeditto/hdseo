import {describe,expect,it} from "vitest";
import {buildGrowthRunway} from "../lib/agent-service/growth-runway";
import {investmentPolicyForPlan} from "../lib/seo/investment-policy";

const candidate=(id:string,keyword:string,profit:number,extra:Record<string,unknown>={})=>({
  id,
  status:"open",
  action_type:"IMPROVE",
  target_url:"https://example.com/roofing",
  opportunity_score:48,
  confidence_score:80,
  reason_codes:["LOCAL_RELEVANCE","VALUE_BELOW_PLAN_THRESHOLD"],
  evidence:{
    keyword,
    currentRank:58,
    economicsConfidence:.5,
    businessValue:{expectedMonthlyProfit:profit,implementationCost:350},
  },
  ...extra,
});

describe("compound growth runway",()=>{
  it("shows related local searches as a watched campaign without authorizing it",()=>{
    const runway=buildGrowthRunway([
      candidate("one","roof repair jacksonville",80),
      candidate("two","emergency roof repair jacksonville",60),
    ],"service_area",investmentPolicyForPlan("pro"));

    expect(runway).toHaveLength(1);
    expect(runway[0]).toMatchObject({
      id:"one",
      keywords:["roof repair jacksonville","emergency roof repair jacksonville"],
      currentMonthlyProfit:110,
      capacityUnits:1,
    });
    expect(runway[0].requiredMonthlyProfit).toBeGreaterThan(110);
    expect(runway[0].milestones.length).toBeGreaterThan(0);
  });

  it("never places an out-of-area candidate on the runway",()=>{
    const runway=buildGrowthRunway([
      candidate("outside","roof repair miami",500,{
        reason_codes:["OUTSIDE_SERVICE_AREA","VALUE_BELOW_PLAN_THRESHOLD"],
      }),
    ],"service_area",investmentPolicyForPlan("pro"));

    expect(runway).toEqual([]);
  });
});
