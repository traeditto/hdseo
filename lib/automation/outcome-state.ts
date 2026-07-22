export const healthyProductionStepKeys=["implementation","preview","qa","publish"] as const;

export function healthyProductionOutcomeState(input:{
  executionId:string;
  deploymentId:string;
  now:string;
}){
  return{
    run:{
      status:"monitoring",
      current_step:"monitor",
      execution_id:input.executionId,
      deployment_id:input.deploymentId,
      failure_code:null,
      failure_message:null,
      completed_at:null,
      updated_at:input.now,
    },
    cycle:{
      status:"monitoring",
      stage:"monitor",
      execution_id:input.executionId,
      deployment_id:input.deploymentId,
      failure_code:null,
      failure_message:null,
      completed_at:null,
      updated_at:input.now,
    },
    completedStep:{
      status:"succeeded",
      completed_at:input.now,
      updated_at:input.now,
    },
    monitorStep:{
      status:"running",
      deployment_id:input.deploymentId,
      started_at:input.now,
      completed_at:null,
      updated_at:input.now,
    },
  } as const;
}
