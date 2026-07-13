export type ImplementationPath="wordpress_package"|"generic_cms"|"developer_ticket"|"repository";
export interface PathInput{cmsType?:string|null;actionType:string;repositoryRequested?:boolean;repositoryReady?:boolean;}
export function selectImplementationPath(input:PathInput):{path:ImplementationPath;risk:"low"|"medium"|"high";reason:string}{
  const technical=["TECHNICAL","WRONG_PAGE"].includes(input.actionType),high=["BUILD","LOCALIZE"].includes(input.actionType);
  if(input.repositoryRequested&&input.repositoryReady)return{path:"repository",risk:high?"high":technical?"medium":"low",reason:"Verified repository execution was explicitly requested and passed every readiness gate."};
  if((input.cmsType??"").toLowerCase()==="wordpress")return{path:"wordpress_package",risk:high?"high":technical?"medium":"low",reason:"The project uses WordPress, so HD SEO will prepare a complete manual implementation package."};
  if(technical)return{path:"developer_ticket",risk:"medium",reason:"The action requires technical implementation and verification by a developer."};
  return{path:"generic_cms",risk:high?"high":"low",reason:"No verified repository path is required; a CMS-neutral implementation package is safest."};
}
