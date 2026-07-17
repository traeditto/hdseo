import type { GitHubRepository } from "@/lib/github/app-client";

const ignoredWords=new Set(["app","client","company","inc","llc","main","primary","project","repo","repository","seo","site","website","www","com","net","org"]);
const words=(value:string)=>value.toLowerCase().split(/[^a-z0-9]+/).filter(word=>word.length>=3&&!ignoredWords.has(word));
const compact=(value:string)=>words(value).join("");

function domainName(value:string){
  try{return new URL(value.includes("://")?value:`https://${value}`).hostname.replace(/^www\./,"").split(".")[0]??"";}catch{return value;}
}

function score(repository:GitHubRepository,identity:{clientName:string;projectName:string;domain:string}){
  const repositoryCompact=compact(repository.name),repositoryWords=new Set(words(repository.name));
  const targets=[identity.clientName,domainName(identity.domain),identity.projectName].map(value=>({compact:compact(value),words:words(value)})).filter(value=>value.compact.length>=4);
  return targets.reduce((best,target)=>{
    let value=0;
    if(repositoryCompact===target.compact)value=120;
    else if(repositoryCompact.startsWith(target.compact)||target.compact.startsWith(repositoryCompact))value=90;
    else if(repositoryCompact.includes(target.compact)||target.compact.includes(repositoryCompact))value=70;
    value+=target.words.filter(word=>repositoryWords.has(word)).length*15;
    return Math.max(best,value);
  },0);
}

export function selectRepositoryForProject(repositories:GitHubRepository[],identity:{clientName:string;projectName:string;domain:string}){
  if(repositories.length===1)return repositories[0];
  const ranked=repositories.map(repository=>({repository,score:score(repository,identity)})).sort((left,right)=>right.score-left.score);
  if(!ranked[0]||ranked[0].score<30||ranked[0].score===ranked[1]?.score)return null;
  return ranked[0].repository;
}
