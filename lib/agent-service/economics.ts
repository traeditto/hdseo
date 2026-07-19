export type TokenUsage={inputTokens:number;cachedInputTokens:number;outputTokens:number};
type ModelRate={input:number;cachedInput:number;output:number};

const rates:Record<string,ModelRate>={
  "gpt-5.6-sol":{input:5,cachedInput:.5,output:30},
  "gpt-5.6":{input:5,cachedInput:.5,output:30},
  "gpt-5.6-terra":{input:2.5,cachedInput:.25,output:15},
  "gpt-5.6-luna":{input:1,cachedInput:.1,output:6},
};
const conservative:ModelRate={input:10,cachedInput:1,output:60};
const round=(value:number)=>Number(Math.max(0,value).toFixed(6));

export function modelRate(model:string){return rates[model]??conservative;}
export function estimateTextTokens(value:string){return Math.max(1,Math.ceil(value.length/4));}
export function calculateModelCost(model:string,usage:TokenUsage){
  const rate=modelRate(model),cached=Math.min(usage.inputTokens,Math.max(0,usage.cachedInputTokens)),uncached=Math.max(0,usage.inputTokens-cached);
  return round((uncached*rate.input+cached*rate.cachedInput+Math.max(0,usage.outputTokens)*rate.output)/1_000_000);
}
export function estimateMaximumModelCost(model:string,input:string,maxOutputTokens:number){
  return calculateModelCost(model,{inputTokens:estimateTextTokens(input),cachedInputTokens:0,outputTokens:maxOutputTokens});
}

export function capacityUnitEconomics(input:{priceCents:number;providerBudgetDollars:number;processingReserveBps?:number;processingFixedCents?:number}){
  const processing=Math.ceil(input.priceCents*(input.processingReserveBps??350)/10_000+(input.processingFixedCents??30));
  const variableCost=processing+Math.round(input.providerBudgetDollars*100),contribution=input.priceCents-variableCost;
  return{processingReserveCents:processing,maxVariableCostCents:variableCost,contributionCents:contribution,contributionMarginPercent:Number((contribution/input.priceCents*100).toFixed(1))};
}
