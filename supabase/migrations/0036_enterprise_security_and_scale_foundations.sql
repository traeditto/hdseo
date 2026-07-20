-- HD SEO enterprise security and scale foundations.
-- Production writes remain approval-only until independently verified gates pass.

create table public.platform_security_controls (
  id boolean primary key default true check(id),
  approval_only_mode boolean not null default true,
  external_mutations_disabled boolean not null default false,
  provider_spend_disabled boolean not null default false,
  incident_mode boolean not null default false,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
insert into public.platform_security_controls(id) values(true) on conflict(id) do nothing;

create table public.tenant_quotas (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  project_id uuid references public.seo_projects(id) on delete cascade,
  quota_key text not null,
  hard_limit numeric not null check(hard_limit>=0),
  warning_percent numeric not null default 80 check(warning_percent between 1 and 100),
  period text not null default 'month' check(period in ('minute','hour','day','month')),
  status text not null default 'active' check(status in ('active','paused')),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index tenant_quotas_project_key on public.tenant_quotas(agency_id,project_id,quota_key) where project_id is not null;
create unique index tenant_quotas_agency_key on public.tenant_quotas(agency_id,quota_key) where project_id is null;
alter table public.tenant_quotas add constraint tenant_quotas_project_tenant_fk
  foreign key(agency_id,project_id) references public.seo_projects(agency_id,id) on delete cascade;

-- Enterprise control-plane tables originally carried independent foreign keys.
-- Bind every relationship to the same agency/client/project tuple so a valid ID
-- from one tenant can never be combined with a valid ID from another tenant.
alter table public.clients
  add constraint clients_agency_id_unique unique(agency_id,id),
  add constraint clients_agency_organization_id_unique unique(agency_id,organization_id,id);
alter table public.github_installations
  add constraint github_installations_agency_id_unique unique(agency_id,id);
alter table public.vercel_connections
  add constraint vercel_connections_agency_id_unique unique(agency_id,id);

alter table public.repositories add column client_organization_id uuid;
update public.repositories r set client_organization_id=c.organization_id
from public.clients c where c.id=r.client_id and c.agency_id=r.agency_id;
alter table public.repositories alter column client_organization_id set not null;
alter table public.repositories
  add constraint repositories_agency_id_unique unique(agency_id,id),
  add constraint repositories_client_tenant_fk foreign key(agency_id,client_organization_id,client_id)
    references public.clients(agency_id,organization_id,id) on delete cascade,
  add constraint repositories_project_tenant_fk foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  add constraint repositories_installation_tenant_fk foreign key(agency_id,github_installation_id)
    references public.github_installations(agency_id,id) on delete restrict;

alter table public.vercel_projects add column client_organization_id uuid;
update public.vercel_projects v set client_organization_id=c.organization_id
from public.clients c where c.id=v.client_id and c.agency_id=v.agency_id;
alter table public.vercel_projects alter column client_organization_id set not null;
alter table public.vercel_projects
  add constraint vercel_projects_agency_id_unique unique(agency_id,id),
  add constraint vercel_projects_client_tenant_fk foreign key(agency_id,client_organization_id,client_id)
    references public.clients(agency_id,organization_id,id) on delete cascade,
  add constraint vercel_projects_project_tenant_fk foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  add constraint vercel_projects_connection_tenant_fk foreign key(agency_id,connection_id)
    references public.vercel_connections(agency_id,id) on delete restrict,
  add constraint vercel_projects_repository_tenant_fk foreign key(agency_id,repository_id)
    references public.repositories(agency_id,id) on delete set null (repository_id);

alter table public.seo_jobs add column client_organization_id uuid;
update public.seo_jobs j set client_organization_id=c.organization_id
from public.clients c where c.id=j.client_id and c.agency_id=j.agency_id;
alter table public.seo_jobs alter column client_organization_id set not null;
alter table public.seo_jobs
  add constraint seo_jobs_agency_id_unique unique(agency_id,id),
  add constraint seo_jobs_client_tenant_fk foreign key(agency_id,client_organization_id,client_id)
    references public.clients(agency_id,organization_id,id) on delete cascade,
  add constraint seo_jobs_project_tenant_fk foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  add constraint seo_jobs_repository_tenant_fk foreign key(agency_id,repository_id)
    references public.repositories(agency_id,id) on delete restrict;

alter table public.automation_runs
  add constraint automation_runs_agency_id_unique unique(agency_id,id),
  add constraint automation_runs_job_tenant_fk foreign key(agency_id,seo_job_id)
    references public.seo_jobs(agency_id,id) on delete cascade;

alter table public.deployments add column client_organization_id uuid;
update public.deployments d set client_organization_id=c.organization_id
from public.clients c where c.id=d.client_id and c.agency_id=d.agency_id;
alter table public.deployments alter column client_organization_id set not null;
alter table public.deployments
  add constraint deployments_agency_id_unique unique(agency_id,id),
  add constraint deployments_client_tenant_fk foreign key(agency_id,client_organization_id,client_id)
    references public.clients(agency_id,organization_id,id) on delete cascade,
  add constraint deployments_project_tenant_fk foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  add constraint deployments_vercel_project_tenant_fk foreign key(agency_id,vercel_project_id)
    references public.vercel_projects(agency_id,id) on delete restrict,
  add constraint deployments_repository_tenant_fk foreign key(agency_id,repository_id)
    references public.repositories(agency_id,id) on delete set null (repository_id),
  add constraint deployments_automation_tenant_fk foreign key(agency_id,automation_run_id)
    references public.automation_runs(agency_id,id) on delete set null (automation_run_id),
  add constraint deployments_previous_tenant_fk foreign key(agency_id,previous_deployment_id)
    references public.deployments(agency_id,id) on delete set null (previous_deployment_id),
  add constraint deployments_rollback_tenant_fk foreign key(agency_id,rollback_of_id)
    references public.deployments(agency_id,id) on delete set null (rollback_of_id);

alter table public.background_jobs
  add constraint background_jobs_automation_tenant_fk foreign key(agency_id,automation_run_id)
    references public.automation_runs(agency_id,id) on delete cascade,
  add constraint background_jobs_deployment_tenant_fk foreign key(agency_id,deployment_id)
    references public.deployments(agency_id,id) on delete cascade;

create table public.provider_rate_buckets (
  scope_key text not null,
  provider text not null,
  operation text not null,
  capacity numeric not null check(capacity>0),
  tokens numeric not null check(tokens>=0),
  refill_per_second numeric not null check(refill_per_second>0),
  blocked_until timestamptz,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key(scope_key,provider,operation)
);

create table public.api_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  idempotency_key text not null,
  request_fingerprint text not null check(length(request_fingerprint)=64),
  operation text not null,
  status text not null default 'processing' check(status in ('processing','succeeded','failed')),
  response_status integer,
  response_body jsonb,
  locked_until timestamptz not null default now()+interval '5 minutes',
  expires_at timestamptz not null default now()+interval '24 hours',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(scope_key,idempotency_key)
);
create index api_idempotency_expiry_idx on public.api_idempotency_records(expires_at);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references public.agencies(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  severity text not null check(severity in ('info','warning','high','critical')),
  outcome text not null check(outcome in ('allowed','blocked','failed','observed')),
  request_id text,trace_id text,source_ip_hash text,user_agent_hash text,
  resource_type text,resource_id text,metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index security_events_time_idx on public.security_events(occurred_at desc);
create index security_events_agency_time_idx on public.security_events(agency_id,occurred_at desc);

create table public.break_glass_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  agency_id uuid references public.agencies(id) on delete set null,
  reason text not null check(length(reason)>=20),
  permissions text[] not null check(cardinality(permissions)>0),
  status text not null default 'active' check(status in ('active','expired','revoked','reviewed')),
  expires_at timestamptz not null check(expires_at<=created_at+interval '60 minutes'),
  revoked_by uuid references auth.users(id),revoked_at timestamptz,
  reviewed_by uuid references auth.users(id),reviewed_at timestamptz,review_notes text,
  created_at timestamptz not null default now()
);

create table public.audit_ledger (
  sequence bigint generated always as identity primary key,
  event_id uuid not null unique default gen_random_uuid(),
  agency_id uuid references public.agencies(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,resource_type text not null,resource_id text,
  event_payload jsonb not null default '{}',previous_hash text,event_hash text not null,
  occurred_at timestamptz not null default now()
);

create or replace function public.block_append_only_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'APPEND_ONLY_LEDGER'; end $$;
create trigger audit_ledger_append_only before update or delete on public.audit_ledger
for each row execute function public.block_append_only_mutation();
create trigger security_events_append_only before update or delete on public.security_events
for each row execute function public.block_append_only_mutation();

create or replace function public.append_audit_ledger(
  p_agency_id uuid,p_actor_user_id uuid,p_action text,p_resource_type text,
  p_resource_id text,p_event_payload jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_previous text;v_event uuid:=gen_random_uuid();v_time timestamptz:=clock_timestamp();v_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('hdseo-audit-ledger',0));
  select event_hash into v_previous from public.audit_ledger order by sequence desc limit 1;
  v_hash:=encode(extensions.digest(coalesce(v_previous,'')||v_event::text||v_time::text||p_action||p_resource_type||coalesce(p_resource_id,'')||coalesce(p_event_payload,'{}')::text,'sha256'),'hex');
  insert into public.audit_ledger(event_id,agency_id,actor_user_id,action,resource_type,resource_id,event_payload,previous_hash,event_hash,occurred_at)
  values(v_event,p_agency_id,p_actor_user_id,p_action,p_resource_type,p_resource_id,coalesce(p_event_payload,'{}'),v_previous,v_hash,v_time);
  return v_event;
end $$;

create table public.queue_outbox (
  id uuid primary key default gen_random_uuid(),
  background_job_id uuid not null references public.background_jobs(id) on delete cascade,
  topic text not null,schema_version integer not null default 2,
  envelope jsonb not null,publish_after timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','publishing','published','failed','dead_letter')),
  attempt_count integer not null default 0,max_attempts integer not null default 12,
  locked_by text,locked_until timestamptz,last_error_code text,last_error_message text,published_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(background_job_id,topic)
);
create index queue_outbox_claim_idx on public.queue_outbox(status,publish_after,created_at) where status in ('pending','failed');

create table public.queue_delivery_attempts (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.queue_outbox(id) on delete cascade,
  attempt_number integer not null,provider_message_id text,outcome text not null,
  error_code text,error_message text,duration_ms integer,
  attempted_at timestamptz not null default now(),unique(outbox_id,attempt_number)
);

create or replace function public.enqueue_background_job_outbox()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_kind text;v_topic text;
begin
  select case
    when new.queue='evidence' and new.job_type='crawler.crawl' then 'crawl.run'
    when new.queue='evidence' then 'evidence.sync'
    when new.queue='agents' then 'agent.work'
    when new.queue='deployments' and new.job_type like '%rollback%' then 'deployment.rollback'
    when new.queue='deployments' then 'deployment.create'
    when new.queue in ('notifications','reporting') then case when new.queue='notifications' then 'notification.send' else 'report.generate' end
    when new.queue='webhooks' then 'webhook.process'
    else null end into v_kind;
  if v_kind is null then return new; end if;
  v_topic:=case v_kind when 'crawl.run' then 'crawls' when 'evidence.sync' then 'evidence-sync'
    when 'agent.work' then 'agent-work' when 'deployment.create' then 'deployments'
    when 'deployment.rollback' then 'deployments' when 'notification.send' then 'notifications'
    when 'report.generate' then 'reporting' else 'webhooks' end;
  insert into public.queue_outbox(background_job_id,topic,schema_version,envelope,publish_after)
  values(new.id,v_topic,2,jsonb_build_object(
    'schemaVersion',2,'jobId',new.id,'kind',v_kind,
    'tenant',jsonb_build_object('agencyId',new.agency_id,'clientId',new.client_organization_id,'projectId',new.project_id),
    'priority',new.priority,'idempotencyKey',new.idempotency_key,
    'trace',jsonb_build_object('requestId',coalesce(new.payload->>'requestId',new.id::text),'traceparent',new.payload->>'traceparent'),
    'deadline',to_jsonb(new.available_at+interval '24 hours'),'createdAt',to_jsonb(new.created_at)
  ),new.available_at) on conflict(background_job_id,topic) do nothing;
  return new;
end $$;
create trigger background_job_transactional_outbox after insert on public.background_jobs
for each row execute function public.enqueue_background_job_outbox();

create or replace function public.claim_background_jobs(
  p_worker_id text,p_batch_size int default 10,p_lock_seconds int default 300,p_queue text default 'automation'
) returns setof public.background_jobs
language plpgsql security definer set search_path='' as $$
begin
  return query with eligible as (
    select j.id,j.agency_id,j.project_id,j.priority,j.available_at,j.created_at,
      (select count(*) from public.background_jobs r where r.status='running' and r.lock_expires_at>now() and r.agency_id=j.agency_id) agency_running,
      (select count(*) from public.background_jobs r where r.status='running' and r.lock_expires_at>now() and r.project_id=j.project_id) project_running
    from public.background_jobs j where j.queue=p_queue and j.status in ('queued','retry_scheduled')
      and j.available_at<=now() and (j.lock_expires_at is null or j.lock_expires_at<now()) and j.attempt_count<j.max_attempts
  ),ranked as (
    select e.*,row_number() over(partition by e.agency_id order by e.priority desc,e.available_at,e.created_at) agency_rank,
      row_number() over(partition by e.project_id order by e.priority desc,e.available_at,e.created_at) project_rank
    from eligible e
  ),candidates as (
    select j.id from public.background_jobs j join ranked r on r.id=j.id
    where r.agency_rank<=greatest(0,10-r.agency_running)
      and (r.project_id is null or r.project_rank<=greatest(0,2-r.project_running))
    order by r.priority desc,r.available_at,r.created_at
    for update of j skip locked limit greatest(1,least(p_batch_size,50))
  )
  update public.background_jobs j set status='running',worker_id=p_worker_id,locked_at=now(),
    lock_expires_at=now()+make_interval(secs=>greatest(30,least(p_lock_seconds,900))),fencing_token=gen_random_uuid(),
    attempt_count=j.attempt_count+1,updated_at=now()
  from candidates where j.id=candidates.id returning j.*;
end $$;

create or replace function public.consume_provider_rate_token(
  p_scope_key text,p_provider text,p_operation text,p_capacity numeric,p_refill_per_second numeric,p_cost numeric default 1
) returns table(allowed boolean,remaining numeric,retry_after_seconds integer)
language plpgsql security definer set search_path='' as $$
declare v_bucket public.provider_rate_buckets;v_now timestamptz:=clock_timestamp();v_tokens numeric;
begin
  if p_capacity<=0 or p_refill_per_second<=0 or p_cost<=0 then raise exception 'RATE_BUCKET_INVALID'; end if;
  insert into public.provider_rate_buckets(scope_key,provider,operation,capacity,tokens,refill_per_second,updated_at)
    values(p_scope_key,p_provider,p_operation,p_capacity,p_capacity,p_refill_per_second,v_now)
    on conflict(scope_key,provider,operation) do nothing;
  select * into v_bucket from public.provider_rate_buckets where scope_key=p_scope_key and provider=p_provider and operation=p_operation for update;
  if v_bucket.blocked_until is not null and v_bucket.blocked_until>v_now then
    return query select false,v_bucket.tokens,ceil(extract(epoch from v_bucket.blocked_until-v_now))::integer;return;
  end if;
  v_tokens:=least(v_bucket.capacity,v_bucket.tokens+extract(epoch from v_now-v_bucket.updated_at)*v_bucket.refill_per_second);
  if v_tokens<p_cost then
    update public.provider_rate_buckets set tokens=v_tokens,updated_at=v_now,version=version+1 where scope_key=p_scope_key and provider=p_provider and operation=p_operation;
    return query select false,v_tokens,ceil((p_cost-v_tokens)/v_bucket.refill_per_second)::integer;return;
  end if;
  v_tokens:=v_tokens-p_cost;
  update public.provider_rate_buckets set tokens=v_tokens,capacity=p_capacity,refill_per_second=p_refill_per_second,blocked_until=null,updated_at=v_now,version=version+1 where scope_key=p_scope_key and provider=p_provider and operation=p_operation;
  return query select true,v_tokens,0;
end $$;

create or replace function public.extend_agent_service_enrollment_lease(p_enrollment_id uuid,p_worker_id text,p_lock_seconds int default 300)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_updated int;
begin
  update public.agent_service_enrollments set lock_expires_at=now()+make_interval(secs=>greatest(30,least(p_lock_seconds,900))),updated_at=now()
  where id=p_enrollment_id and worker_id=p_worker_id and lock_expires_at>now();
  get diagnostics v_updated=row_count;return v_updated=1;
end $$;

create table public.data_retention_policies (
  data_class text primary key,retention_days integer not null check(retention_days between 1 and 36500),
  archive_days integer check(archive_days is null or archive_days>=retention_days),
  legal_basis text not null,deletion_mode text not null check(deletion_mode in ('hard_delete','anonymize','archive')),
  updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
insert into public.data_retention_policies(data_class,retention_days,archive_days,legal_basis,deletion_mode) values
 ('analytics_detail',487,1095,'service_delivery','archive'),('raw_crawl_artifacts',30,30,'service_delivery','hard_delete'),
 ('webhook_payloads',30,400,'security_and_reliability','hard_delete'),('operational_logs',30,365,'security_and_reliability','archive'),
 ('security_audit',2557,2557,'legal_and_security','archive'),('revoked_credentials',1,1,'credential_revocation','hard_delete')
on conflict(data_class) do nothing;

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),agency_id uuid references public.agencies(id) on delete set null,
  client_organization_id uuid references public.client_organizations(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  request_type text not null check(request_type in ('access','export','delete','correct','restrict','object')),
  jurisdiction text,status text not null default 'received' check(status in ('received','identity_verification','in_progress','blocked_legal_hold','completed','rejected')),
  due_at timestamptz not null,completed_at timestamptz,export_object_key text,deletion_ledger jsonb not null default '{}',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

alter table public.integration_oauth_states
  add column if not exists purpose text,
  add column if not exists state_digest text,
  add column if not exists callback_host text,
  add column if not exists consumed_by_ip_hash text;
create unique index if not exists integration_oauth_state_digest_unique on public.integration_oauth_states(state_digest) where state_digest is not null;

create or replace function public.consume_integration_oauth_state_v2(
  p_state_id uuid,p_provider text,p_purpose text,p_agency_id uuid,p_user_id uuid,
  p_nonce text,p_callback_host text,p_state_digest text,p_ip_hash text default null
) returns setof public.integration_oauth_states
language plpgsql security definer set search_path='' as $$
begin
  return query update public.integration_oauth_states s set consumed_at=now(),consumed_by_ip_hash=p_ip_hash
  where s.id=p_state_id and s.provider=p_provider and coalesce(s.purpose,s.provider)=p_purpose
    and s.agency_id=p_agency_id and s.user_id=p_user_id and s.consumed_at is null and s.expires_at>now()
    and s.context->>'nonce'=p_nonce and coalesce(s.callback_host,p_callback_host)=p_callback_host
    and s.state_digest=p_state_digest
  returning s.*;
end $$;

alter table public.mutation_intents
  add column if not exists policy_version text not null default 'safety-v2',
  add column if not exists evidence_digest text,
  add column if not exists reserved_budget numeric not null default 0 check(reserved_budget>=0),
  add column if not exists approval_identities jsonb not null default '[]',
  add column if not exists validation_contract jsonb not null default '{}',
  add column if not exists rollback_plan jsonb not null default '{}',
  add column if not exists risk_reason text,
  add column if not exists model_provider text,
  add column if not exists model_version text,
  add column if not exists not_before timestamptz;

do $$ declare t text;
begin
  foreach t in array array['integration_connections','cms_connections','vercel_connections'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists secret_envelope_version integer, add column if not exists kms_key_version text, add column if not exists wrapped_data_key text, add column if not exists secret_iv text, add column if not exists secret_tag text, add column if not exists secret_ciphertext text, add column if not exists secret_aad_digest text',t);
    end if;
  end loop;
end $$;

create or replace view public.security_posture_catalog as
select n.nspname as schema_name,c.relname as relation_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls,
  pg_get_userbyid(c.relowner) as owner_name,
  (select count(*) from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname)::integer as policy_count
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p');

do $$ declare t text;
begin
  foreach t in array array['platform_security_controls','tenant_quotas','provider_rate_buckets','api_idempotency_records','security_events','break_glass_events','audit_ledger','queue_outbox','queue_delivery_attempts','data_retention_policies','privacy_requests'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
  end loop;
end $$;
revoke all on public.security_posture_catalog from anon,authenticated;
revoke all on function public.append_audit_ledger(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.consume_integration_oauth_state_v2(uuid,text,text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.consume_provider_rate_token(text,text,text,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.extend_agent_service_enrollment_lease(uuid,text,int) from public,anon,authenticated;
revoke all on function public.enqueue_background_job_outbox() from public,anon,authenticated;
grant execute on function public.append_audit_ledger(uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.consume_integration_oauth_state_v2(uuid,text,text,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.consume_provider_rate_token(text,text,text,numeric,numeric,numeric) to service_role;
grant execute on function public.extend_agent_service_enrollment_lease(uuid,text,int) to service_role;

comment on table public.queue_outbox is 'Transactional publish intents for Pub/Sub. Envelopes contain identifiers and trace context only; never credentials.';
comment on table public.audit_ledger is 'Append-only hash-chained security and business audit evidence.';
comment on table public.platform_security_controls is 'Platform kill switches. Approval-only mode remains enabled until release gates pass.';

create or replace function public.provision_platform_admin(
  p_user_id uuid,p_role text,p_actor_user_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if p_role not in ('platform_admin','platform_owner','support_admin') or length(trim(p_reason))<20 then
    raise exception 'ADMIN_PROVISIONING_INVALID';
  end if;
  if p_actor_user_id is not null and not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and status='active') then
    raise exception 'ACTIVE_ADMIN_REQUIRED';
  end if;
  insert into public.platform_admins(user_id,role,status)
  values(p_user_id,p_role,'active') on conflict(user_id) do update set role=excluded.role,status='active'
  returning id into v_id;
  perform public.append_audit_ledger(null,p_actor_user_id,'platform_admin.provisioned','platform_admin',v_id::text,
    jsonb_build_object('targetUserId',p_user_id,'role',p_role,'reason',p_reason));
  return v_id;
end $$;
revoke all on function public.provision_platform_admin(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.provision_platform_admin(uuid,text,uuid,text) to service_role;
