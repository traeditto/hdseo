export interface BusinessValueInput {
  monthlyImpressions: number;
  currentCtr: number;
  achievableCtr: number;
  leadConversionRate: number;
  qualifiedLeadRate: number;
  closeRate: number;
  grossProfitPerSale: number;
  probabilityOfLift: number;
  evidenceConfidence: number;
  implementationCost: number;
  timeToSignalDays: number;
  risk: "low"|"medium"|"high"|"critical";
}

const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));
const nonnegative=(value:number)=>Math.max(0,Number.isFinite(value)?value:0);

/** Conservative expected-value model. Rates are decimals (0.05 = 5%). */
export function calculateBusinessValue(input:BusinessValueInput){
  const incrementalVisits=nonnegative(input.monthlyImpressions)*(clamp(input.achievableCtr)-clamp(input.currentCtr));
  const expectedLeads=Math.max(0,incrementalVisits)*clamp(input.leadConversionRate)*clamp(input.qualifiedLeadRate);
  const expectedSales=expectedLeads*clamp(input.closeRate);
  const grossProfit=expectedSales*nonnegative(input.grossProfitPerSale);
  const riskMultiplier={low:1,medium:.85,high:.65,critical:.35}[input.risk];
  const confidence=clamp(input.evidenceConfidence);
  const probability=clamp(input.probabilityOfLift);
  const expectedMonthlyProfit=grossProfit*probability*confidence*riskMultiplier;
  const implementationCost=nonnegative(input.implementationCost);
  const paybackMonths=expectedMonthlyProfit>0?implementationCost/expectedMonthlyProfit:null;
  const velocityMultiplier=1/(1+nonnegative(input.timeToSignalDays)/90);
  const priorityScore=Math.round(Math.min(100,Math.max(0,(expectedMonthlyProfit/(implementationCost+100))*22*velocityMultiplier+confidence*35+probability*20)));
  return{incrementalVisits:+incrementalVisits.toFixed(2),expectedLeads:+expectedLeads.toFixed(2),expectedSales:+expectedSales.toFixed(2),expectedMonthlyProfit:+expectedMonthlyProfit.toFixed(2),implementationCost:+implementationCost.toFixed(2),paybackMonths:paybackMonths==null?null:+paybackMonths.toFixed(2),timeToSignalDays:Math.round(nonnegative(input.timeToSignalDays)),confidence:+confidence.toFixed(4),priorityScore};
}
