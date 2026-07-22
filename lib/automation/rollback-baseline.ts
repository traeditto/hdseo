import type {VercelDeployment} from "@/lib/vercel/client";

function timestamp(value:number|undefined){
  if(!Number.isFinite(value))return null;
  return Number(value)<10_000_000_000?Number(value)*1000:Number(value);
}

export function providerDeploymentTime(deployment:VercelDeployment){
  return timestamp(deployment.createdAt)??timestamp(deployment.ready);
}

/** Select the closest known-good production deployment that predates this release. */
export function selectPriorProductionDeployment(deployments:VercelDeployment[],current:VercelDeployment){
  const currentTime=providerDeploymentTime(current);
  return deployments
    .filter(candidate=>candidate.id!==current.id)
    .filter(candidate=>(candidate.readyState??"").toUpperCase()==="READY")
    .filter(candidate=>!candidate.target||candidate.target==="production")
    .filter(candidate=>{
      const candidateTime=providerDeploymentTime(candidate);
      return currentTime===null||candidateTime===null||candidateTime<currentTime;
    })
    .sort((left,right)=>(providerDeploymentTime(right)??0)-(providerDeploymentTime(left)??0))[0]??null;
}

export function providerDeploymentIso(value:number|undefined,fallback:string){
  const normalized=timestamp(value);
  return normalized===null?fallback:new Date(normalized).toISOString();
}
