import {actionDigest} from "@/lib/safety/action-digest";
import type {MutationAction} from "@/lib/safety/mutation-gateway";

type ApprovedFile={path:string;content:string};
type Opportunity={opportunityScore:unknown;confidenceScore:unknown;targetMilestone:unknown;evidence:Record<string,unknown>};

export function repositoryPullRequestPlan(input:{agencyId:string;clientId:string;projectId:string;executionId:string;repositoryConnectionId:string;baseBranch:string;baseCommitSha:string;files:ApprovedFile[];opportunity:Opportunity}){
  const keyword=typeof input.opportunity.evidence.keyword==="string"?input.opportunity.evidence.keyword:"approved SEO opportunity",businessValue=input.opportunity.evidence.businessValue&&typeof input.opportunity.evidence.businessValue==="object"&&!Array.isArray(input.opportunity.evidence.businessValue)?input.opportunity.evidence.businessValue as Record<string,unknown>:{},branch=`hd-seo/${input.executionId.slice(0,8)}`,files=[...input.files].sort((a,b)=>a.path.localeCompare(b.path)),title=`SEO: ${keyword}`,body=`## HD SEO execution

- Opportunity score: ${input.opportunity.opportunityScore}
- Confidence: ${input.opportunity.confidenceScore}
- Expected monthly gross profit: $${Number(businessValue.expectedMonthlyProfit??0).toFixed(0)} (directional, not guaranteed)
- Target: ${input.opportunity.targetMilestone}
- Files: human reviewed and approved
- Preview: must pass health, technical SEO, schema, links, Lighthouse, sitemap, robots, indexing-readiness, and drift validation
- Publishing: requires an authorized merge after preview review

Observed outcomes are monitored without claiming causation.`;
  const action:MutationAction={agencyId:input.agencyId,clientId:input.clientId,projectId:input.projectId,toolKey:"github.write",resourceType:"repository_connection",resourceId:input.repositoryConnectionId,environment:"preview",payload:{executionId:input.executionId,baseBranch:input.baseBranch,baseCommitSha:input.baseCommitSha,branch,title,body,files:files.map(file=>({path:file.path,contentDigest:actionDigest(file.content)}))}};
  return{action,branch,title,body,files};
}
