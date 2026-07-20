import {actionDigest} from "@/lib/safety/action-digest";

export function implementationPackageSnapshot(pkg:Record<string,unknown>){
  return{
    id:pkg.id??null,version:pkg.version??null,projectId:pkg.project_id??null,opportunityId:pkg.opportunity_id??null,
    implementationPath:pkg.implementation_path??null,cmsMode:pkg.cms_mode??null,riskLevel:pkg.risk_level??null,
    hypothesis:pkg.hypothesis??null,currentState:pkg.current_state??{},proposedState:pkg.proposed_state??{},
    packageData:pkg.package_data??{},requiredEvidence:pkg.required_evidence??[],dependencies:pkg.dependencies??[],
    acceptanceCriteria:pkg.acceptance_criteria??[],verificationChecklist:pkg.verification_checklist??[],
  };
}

export function implementationPackageDigest(pkg:Record<string,unknown>){return actionDigest(implementationPackageSnapshot(pkg));}

