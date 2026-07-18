import{describe,expect,it}from"vitest";
import{calculateBusinessValue}from"../lib/seo/business-value";

describe("business-value scoring",()=>{
  it("uses qualified leads, close rate, gross profit, confidence, risk, and velocity",()=>{
    const result=calculateBusinessValue({monthlyImpressions:10_000,currentCtr:.02,achievableCtr:.06,leadConversionRate:.05,qualifiedLeadRate:.6,closeRate:.25,grossProfitPerSale:2_000,probabilityOfLift:.7,evidenceConfidence:.8,implementationCost:1_000,timeToSignalDays:30,risk:"medium"});
    expect(result.incrementalVisits).toBe(400);expect(result.expectedLeads).toBe(12);expect(result.expectedSales).toBe(3);expect(result.expectedMonthlyProfit).toBe(2856);expect(result.paybackMonths).toBe(.35);expect(result.priorityScore).toBeGreaterThan(50);
  });
  it("never produces negative value from a lower achievable CTR",()=>{
    const result=calculateBusinessValue({monthlyImpressions:1000,currentCtr:.08,achievableCtr:.03,leadConversionRate:.1,qualifiedLeadRate:1,closeRate:1,grossProfitPerSale:1000,probabilityOfLift:1,evidenceConfidence:1,implementationCost:0,timeToSignalDays:1,risk:"low"});
    expect(result.incrementalVisits).toBeLessThan(0);expect(result.expectedLeads).toBe(0);expect(result.expectedMonthlyProfit).toBe(0);expect(result.paybackMonths).toBeNull();
  });
  it("discounts critical-risk actions",()=>{
    const base={monthlyImpressions:5000,currentCtr:.01,achievableCtr:.05,leadConversionRate:.05,qualifiedLeadRate:.8,closeRate:.3,grossProfitPerSale:1000,probabilityOfLift:.8,evidenceConfidence:.8,implementationCost:500,timeToSignalDays:45}as const;
    expect(calculateBusinessValue({...base,risk:"critical"}).expectedMonthlyProfit).toBeLessThan(calculateBusinessValue({...base,risk:"low"}).expectedMonthlyProfit);
  });
});
