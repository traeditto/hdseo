export type OutcomeRecommendation="CONTINUE"|"KEEP"|"IMPROVE"|"ROLLBACK_RECOMMENDED";
type Outcomes={grossProfit?:number;qualifiedLeads?:number;organicSessions?:number;conversions?:number;spend?:number};
const n=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;

export function recommendOutcomeAction(input:{checkpointDay:number;rankDecision:string;baseline:Outcomes;observed:Outcomes}){
  const profitBase=n(input.baseline.grossProfit),profit=n(input.observed.grossProfit),leadBase=n(input.baseline.qualifiedLeads),leads=n(input.observed.qualifiedLeads),profitChange=profitBase>0?(profit-profitBase)/profitBase:null,leadChange=leadBase>0?(leads-leadBase)/leadBase:null;
  let recommendation:OutcomeRecommendation="CONTINUE",reason="More observation time is needed before changing course.";
  if(input.rankDecision==="MILESTONE_REACHED"&&(profitChange==null||profitChange>=-.1)&&(leadChange==null||leadChange>=-.1)){recommendation="KEEP";reason="The ranking milestone was reached without a material decline in qualified leads or gross profit.";}
  else if(input.checkpointDay>=30&&input.rankDecision==="DECLINED"&&profitChange!=null&&leadChange!=null&&profitChange<=-.35&&leadChange<=-.35){recommendation="ROLLBACK_RECOMMENDED";reason="Rankings, qualified leads, and gross profit all declined materially. Review confounders and the last healthy deployment before approving rollback.";}
  else if(input.checkpointDay>=30&&["REVIEW_REQUIRED","DECLINED","TECHNICAL_CHECK"].includes(input.rankDecision)){recommendation="IMPROVE";reason="The change has enough observation time but has not produced the intended ranking and business signal.";}
  else if(input.checkpointDay>=30&&((profitChange??0)>.1||(leadChange??0)>.1)){recommendation="KEEP";reason="Connected business outcomes improved while the change was being monitored.";}
  return{recommendation,reason,comparison:{grossProfitChange:profitChange,qualifiedLeadChange:leadChange,returnOnSpend:n(input.observed.spend)>0?profit/n(input.observed.spend):null}};
}
