-- Keep the atomic deployment queue compatible with the tenant constraints
-- introduced by migrations 0036 and 0046. Those constraints intentionally
-- require client_organization_id on every queued job and deployment.

begin;

create or replace function public.enqueue_deployment_job(
  p_agency_id uuid,
  p_client_organization_id uuid,
  p_project_id uuid,
  p_repository_id uuid,
  p_vercel_project_id uuid,
  p_requested_by uuid,
  p_environment text,
  p_git_ref text,
  p_git_sha text,
  p_idempotency_key text,
  p_priority int default 50
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_job_id uuid;
  v_run_id uuid;
  v_deployment_id uuid;
begin
  select id
  into v_client_id
  from public.clients
  where agency_id = p_agency_id
    and organization_id = p_client_organization_id;

  if v_client_id is null then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.repositories
    where id = p_repository_id
      and agency_id = p_agency_id
      and client_id = v_client_id
      and project_id = p_project_id
      and status = 'active'
      and repository_execution_enabled
  ) then
    raise exception 'REPOSITORY_NOT_READY';
  end if;

  if not exists (
    select 1
    from public.vercel_projects
    where id = p_vercel_project_id
      and agency_id = p_agency_id
      and client_id = v_client_id
      and project_id = p_project_id
      and repository_id = p_repository_id
      and status = 'active'
  ) then
    raise exception 'VERCEL_PROJECT_NOT_READY';
  end if;

  select id
  into v_job_id
  from public.seo_jobs
  where agency_id = p_agency_id
    and idempotency_key = p_idempotency_key;

  if v_job_id is not null then
    select id
    into v_run_id
    from public.automation_runs
    where seo_job_id = v_job_id
    order by created_at
    limit 1;

    select id
    into v_deployment_id
    from public.deployments
    where automation_run_id = v_run_id
    order by created_at
    limit 1;

    return jsonb_build_object(
      'jobId', v_job_id,
      'runId', v_run_id,
      'deploymentId', v_deployment_id,
      'duplicate', true
    );
  end if;

  insert into public.seo_jobs(
    agency_id,
    client_id,
    client_organization_id,
    project_id,
    repository_id,
    job_type,
    status,
    priority,
    input,
    requested_by,
    idempotency_key
  )
  values (
    p_agency_id,
    v_client_id,
    p_client_organization_id,
    p_project_id,
    p_repository_id,
    'deploy',
    'queued',
    p_priority,
    jsonb_build_object(
      'environment', p_environment,
      'gitRef', p_git_ref,
      'gitSha', p_git_sha
    ),
    p_requested_by,
    p_idempotency_key
  )
  returning id into v_job_id;

  insert into public.automation_runs(
    agency_id,
    seo_job_id,
    status,
    current_stage,
    input
  )
  values (
    p_agency_id,
    v_job_id,
    'queued',
    'deploy.create',
    jsonb_build_object(
      'environment', p_environment,
      'gitRef', p_git_ref,
      'gitSha', p_git_sha
    )
  )
  returning id into v_run_id;

  insert into public.deployments(
    agency_id,
    client_id,
    client_organization_id,
    project_id,
    vercel_project_id,
    repository_id,
    automation_run_id,
    environment,
    git_ref,
    git_sha,
    status,
    triggered_by
  )
  values (
    p_agency_id,
    v_client_id,
    p_client_organization_id,
    p_project_id,
    p_vercel_project_id,
    p_repository_id,
    v_run_id,
    p_environment,
    p_git_ref,
    p_git_sha,
    'queued',
    p_requested_by
  )
  returning id into v_deployment_id;

  insert into public.background_jobs(
    queue,
    job_type,
    agency_id,
    automation_run_id,
    deployment_id,
    payload,
    status,
    priority,
    idempotency_key
  )
  values (
    'deployments',
    'deployment.create',
    p_agency_id,
    v_run_id,
    v_deployment_id,
    '{}',
    'queued',
    p_priority,
    'deployment.create:' || v_deployment_id
  );

  return jsonb_build_object(
    'jobId', v_job_id,
    'runId', v_run_id,
    'deploymentId', v_deployment_id,
    'duplicate', false
  );
end
$$;

create or replace function public.enqueue_rollback_job(
  p_agency_id uuid,
  p_source_deployment_id uuid,
  p_target_deployment_id uuid,
  p_requested_by uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.deployments;
  v_target public.deployments;
  v_job_id uuid;
  v_run_id uuid;
  v_deployment_id uuid;
begin
  select *
  into v_source
  from public.deployments
  where id = p_source_deployment_id
    and agency_id = p_agency_id
    and environment = 'production';

  select *
  into v_target
  from public.deployments
  where id = p_target_deployment_id
    and agency_id = p_agency_id
    and environment = 'production'
    and status in ('healthy', 'ready', 'rolled_back');

  if v_source.id is null
    or v_target.id is null
    or v_source.project_id <> v_target.project_id
    or v_source.client_organization_id <> v_target.client_organization_id
    or v_target.external_deployment_id is null
  then
    raise exception 'ROLLBACK_TARGET_INVALID';
  end if;

  select id
  into v_job_id
  from public.seo_jobs
  where agency_id = p_agency_id
    and idempotency_key = p_idempotency_key;

  if v_job_id is not null then
    select id
    into v_run_id
    from public.automation_runs
    where seo_job_id = v_job_id
    order by created_at
    limit 1;

    select id
    into v_deployment_id
    from public.deployments
    where automation_run_id = v_run_id
    order by created_at
    limit 1;

    return jsonb_build_object(
      'jobId', v_job_id,
      'runId', v_run_id,
      'deploymentId', v_deployment_id,
      'duplicate', true
    );
  end if;

  insert into public.seo_jobs(
    agency_id,
    client_id,
    client_organization_id,
    project_id,
    repository_id,
    job_type,
    status,
    input,
    requested_by,
    idempotency_key
  )
  values (
    p_agency_id,
    v_source.client_id,
    v_source.client_organization_id,
    v_source.project_id,
    v_source.repository_id,
    'rollback',
    'queued',
    jsonb_build_object(
      'sourceDeploymentId', v_source.id,
      'targetDeploymentId', v_target.id
    ),
    p_requested_by,
    p_idempotency_key
  )
  returning id into v_job_id;

  insert into public.automation_runs(
    agency_id,
    seo_job_id,
    status,
    current_stage,
    input
  )
  values (
    p_agency_id,
    v_job_id,
    'queued',
    'deployment.rollback',
    jsonb_build_object(
      'sourceDeploymentId', v_source.id,
      'targetDeploymentId', v_target.id
    )
  )
  returning id into v_run_id;

  insert into public.deployments(
    agency_id,
    client_id,
    client_organization_id,
    project_id,
    vercel_project_id,
    repository_id,
    automation_run_id,
    environment,
    git_ref,
    git_sha,
    status,
    previous_deployment_id,
    rollback_of_id,
    triggered_by,
    provider_metadata
  )
  values (
    p_agency_id,
    v_source.client_id,
    v_source.client_organization_id,
    v_source.project_id,
    v_source.vercel_project_id,
    v_source.repository_id,
    v_run_id,
    'production',
    v_target.git_ref,
    v_target.git_sha,
    'queued',
    v_target.id,
    v_source.id,
    p_requested_by,
    jsonb_build_object(
      'targetExternalDeploymentId', v_target.external_deployment_id
    )
  )
  returning id into v_deployment_id;

  insert into public.background_jobs(
    queue,
    job_type,
    agency_id,
    automation_run_id,
    deployment_id,
    payload,
    status,
    priority,
    idempotency_key
  )
  values (
    'deployments',
    'deployment.rollback',
    p_agency_id,
    v_run_id,
    v_deployment_id,
    jsonb_build_object(
      'sourceDeploymentId', v_source.id,
      'targetDeploymentId', v_target.id
    ),
    'queued',
    100,
    'deployment.rollback:' || v_deployment_id
  );

  return jsonb_build_object(
    'jobId', v_job_id,
    'runId', v_run_id,
    'deploymentId', v_deployment_id,
    'duplicate', false
  );
end
$$;

revoke all on function public.enqueue_deployment_job(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, int
) from public, anon, authenticated;
grant execute on function public.enqueue_deployment_job(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, int
) to service_role;

revoke all on function public.enqueue_rollback_job(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_rollback_job(
  uuid, uuid, uuid, uuid, text
) to service_role;

commit;
