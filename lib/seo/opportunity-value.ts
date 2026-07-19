import { calculateBusinessValue } from "./business-value";

export type EconomicAssumptions = {
  leadConversionRate?: number | null;
  qualifiedLeadRate?: number | null;
  closeRate?: number | null;
  grossProfitPerSale?: number | null;
  implementationCost?: number | null;
};

export type OpportunityValueInput = {
  seoScore: number;
  confidenceScore: number;
  searchVolume: number | null;
  impressions?: number | null;
  currentCtr?: number | null;
  currentRank?: number | null;
  targetMilestone: string;
  actionType: string;
  economics: EconomicAssumptions;
};

const number=(value:number|null|undefined,fallback:number)=>Number.isFinite(value)?Number(value):fallback;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

export function estimatedCtrForPosition(position:number|null|undefined){
  if(!position||position>100)return .006;
  if(position<=1)return .28;
  if(position<=3)return .14;
  if(position<=5)return .08;
  if(position<=10)return .035;
  if(position<=20)return .015;
  return .008;
}
function milestoneCtr(value:string){
  if(value==="Position 1")return .28;
  if(value==="Top 3")return .14;
  if(value==="Top 5")return .08;
  if(value==="Top 10")return .035;
  return .015;
}

function riskFor(actionType:string):"low"|"medium"|"high"|"critical"{
  if(actionType==="TECHNICAL")return"high";
  if(actionType==="BUILD"||actionType==="MAPS")return"medium";
  return"low";
}

function timeToSignal(actionType:string){return actionType==="BUILD"?60:actionType==="CONTENT"?45:actionType==="TECHNICAL"?21:30;}

/** Blends search potential with observed business economics. Unknown inputs use
 * conservative defaults and reduce the amount economics can influence selection. */
export function valueOpportunity(input:OpportunityValueInput){
  const provided=[input.economics.leadConversionRate,input.economics.qualifiedLeadRate,input.economics.closeRate,input.economics.grossProfitPerSale,input.economics.implementationCost].filter(value=>value!=null&&Number.isFinite(Number(value))).length;
  const economicsConfidence=provided/5;
  const currentCtr=clamp(number(input.currentCtr,estimatedCtrForPosition(input.currentRank)),0,.5);
  const achievableCtr=Math.max(currentCtr,milestoneCtr(input.targetMilestone));
  const businessValue=calculateBusinessValue({
    monthlyImpressions:Math.max(0,number(input.impressions,input.searchVolume??0)),
    currentCtr,
    achievableCtr,
    leadConversionRate:clamp(number(input.economics.leadConversionRate,.035),0,1),
    qualifiedLeadRate:clamp(number(input.economics.qualifiedLeadRate,.55),0,1),
    closeRate:clamp(number(input.economics.closeRate,.2),0,1),
    grossProfitPerSale:Math.max(0,number(input.economics.grossProfitPerSale,500)),
    probabilityOfLift:clamp(input.confidenceScore/100*.8,0,1),
    evidenceConfidence:clamp((input.confidenceScore/100)*(.55+.45*economicsConfidence),0,1),
    implementationCost:Math.max(0,number(input.economics.implementationCost,input.actionType==="BUILD"?900:350)),
    timeToSignalDays:timeToSignal(input.actionType),
    risk:riskFor(input.actionType),
  });
  const economicsWeight=.15+.3*economicsConfidence;
  const combinedScore=Math.round(clamp(input.seoScore*(1-economicsWeight)+businessValue.priorityScore*economicsWeight,0,100));
  const explanation=businessValue.expectedMonthlyProfit>0
    ?`This opportunity is estimated to produce $${businessValue.expectedMonthlyProfit.toLocaleString("en-US",{maximumFractionDigits:0})} in monthly gross profit if the measured lift occurs, with ${businessValue.paybackMonths==null?"an unconfirmed":`${businessValue.paybackMonths}-month`} payback.`
    :"Search evidence supports the opportunity, but connected revenue evidence is not yet strong enough to forecast positive gross profit.";
  return{combinedScore,economicsConfidence:+economicsConfidence.toFixed(2),businessValue,explanation,assumptions:{currentCtr,achievableCtr,leadConversionRate:number(input.economics.leadConversionRate,.035),qualifiedLeadRate:number(input.economics.qualifiedLeadRate,.55),closeRate:number(input.economics.closeRate,.2),grossProfitPerSale:number(input.economics.grossProfitPerSale,500),implementationCost:number(input.economics.implementationCost,input.actionType==="BUILD"?900:350)}};
}
