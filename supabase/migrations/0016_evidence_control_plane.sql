-- HD SEO production evidence control plane.
-- Adds Google Search Console, bounded crawling, freshness policy, queue scope,
-- OAuth replay protection, and operational heartbeats without replacing any
-- existing workflow tables.

alter table public.integration_oauth_states
  drop constraint if exists integration_oauth_states_provider_check;
alter table public.integration_oauth_states
  add constraint integration_oauth_states_provider_check
  check (provider in ('github','vercel','google_search_console'));

alter table public.background_jobs
  add column client_organization_id uuid references public.client_organizations(id) on delete cascade,
  add column project_id uuid references public.seo_projects(id) on delete cascade,
  add column website_id uuid references public.websites(id) on delete set null,
  add column source_connection_id uuid references public.integration_connections(id) on delete set null;

alter table public.background_jobs
  add constraint background_jobs_project_tenant_fk
  foreign key (agency_id,client_organization_id,project_id)
  references public.seo_projects(agency_id,client_organization_id,id) on delete cascade;

alter table public.background_jobs
  add constraint background_jobs_project_scope_check
  check (
    (client_organization_id is null and project_id is null)
    or (client_organization_id is not null and project_id is not null)
  );

alter table public.seo_page_snapshots
  add column http_status int,
  add column final_url text,
  add column robots_directives text[] not null default '{}',
  add column sitemap_member boolean,
  add column indexable boolean,
  add column content_hash text,
  add column schema_json_ld_valid boolean,
  add column crawl_run_id uuid,
  add column response_bytes int,
  add column crawl_depth int;

create table public.evidence_collection_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  source_connection_id uuid references public.integration_connections(id) on delete set null,
  website_id uuid references public.websites(id) on delete set null,
  run_type text not null check (run_type in ('search_analytics','sitemaps','url_inspection','crawl')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  window_start date,
  window_end date,
  records_read int not null default 0,
  records_written int not null default 0,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id,client_organization_id,project_id,id),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

alter table public.seo_page_snapshots
  add constraint seo_page_snapshots_crawl_run_fk
  foreign key (agency_id,client_organization_id,project_id,crawl_run_id)
  references public.evidence_collection_runs(agency_id,client_organization_id,project_id,id);

create table public.project_evidence_policies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null unique,
  search_console_max_age_hours int not null default 72 check (search_console_max_age_hours between 1 and 720),
  page_snapshot_max_age_hours int not null default 168 check (page_snapshot_max_age_hours between 1 and 2160),
  ranking_max_age_hours int not null default 336 check (ranking_max_age_hours between 1 and 2160),
  keyword_metric_max_age_hours int not null default 720 check (keyword_metric_max_age_hours between 1 and 4320),
  max_crawl_pages int not null default 500 check (max_crawl_pages between 1 and 10000),
  url_inspection_limit int not null default 10 check (url_inspection_limit between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.system_heartbeats (
  component text primary key,
  status text not null default 'healthy' check (status in ('healthy','degraded','failed')),
  worker_id text,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create index background_jobs_project_queue_idx
  on public.background_jobs(project_id,queue,status,created_at desc)
  where project_id is not null;
create index evidence_runs_project_time_idx
  on public.evidence_collection_runs(project_id,run_type,created_at desc);
create index page_snapshot_freshness_idx
  on public.seo_page_snapshots(project_id,captured_at desc);
create index search_console_freshness_idx
  on public.search_console_rows(project_id,captured_at desc);
alter table public.seo_page_snapshots
  add constraint seo_page_snapshots_project_url_crawl_run_unique
  unique (project_id,url,crawl_run_id);

create or replace function public.consume_integration_oauth_state(p_state_id uuid,p_nonce text)
returns setof public.integration_oauth_states
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.integration_oauth_states s
  set consumed_at=now()
  where s.id=p_state_id
    and s.consumed_at is null
    and s.expires_at>now()
    and s.context->>'nonce'=p_nonce
  returning s.*;
end $$;

create or replace function public.enqueue_evidence_job(
  p_agency_id uuid,
  p_client_organization_id uuid,
  p_project_id uuid,
  p_website_id uuid,
  p_source_connection_id uuid,
  p_job_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_priority int default 50
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_job_id uuid;
begin
  if p_job_type not in ('google.search_analytics','google.sitemaps','google.url_inspection','crawler.crawl') then
    raise exception 'INVALID_EVIDENCE_JOB_TYPE';
  end if;
  if not exists (
    select 1 from public.seo_projects
    where id=p_project_id and agency_id=p_agency_id and client_organization_id=p_client_organization_id and status='active'
  ) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p_website_id is not null and not exists (
    select 1 from public.websites
    where id=p_website_id and agency_id=p_agency_id and client_organization_id=p_client_organization_id and project_id=p_project_id
  ) then raise exception 'WEBSITE_NOT_FOUND'; end if;
  if p_source_connection_id is not null and not exists (
    select 1 from public.integration_connections
    where id=p_source_connection_id and agency_id=p_agency_id
      and client_organization_id=p_client_organization_id and project_id=p_project_id
  ) then raise exception 'CONNECTION_NOT_FOUND'; end if;

  insert into public.background_jobs(
    queue,job_type,agency_id,client_organization_id,project_id,website_id,source_connection_id,
    payload,status,priority,idempotency_key
  ) values (
    'evidence',p_job_type,p_agency_id,p_client_organization_id,p_project_id,p_website_id,p_source_connection_id,
    coalesce(p_payload,'{}'::jsonb),'queued',greatest(0,least(p_priority,100)),p_idempotency_key
  )
  on conflict(queue,idempotency_key) do update
    set available_at=case when public.background_jobs.status in ('failed','cancelled','dead_letter') then now() else public.background_jobs.available_at end,
        status=case when public.background_jobs.status in ('failed','cancelled','dead_letter') then 'queued' else public.background_jobs.status end,
        updated_at=now()
  returning id into v_job_id;
  return v_job_id;
end $$;

revoke all on function public.consume_integration_oauth_state(uuid,text) from public,anon,authenticated;
revoke all on function public.enqueue_evidence_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,int) from public,anon,authenticated;
grant execute on function public.consume_integration_oauth_state(uuid,text) to service_role;
grant execute on function public.enqueue_evidence_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,int) to service_role;

alter table public.evidence_collection_runs enable row level security;
alter table public.project_evidence_policies enable row level security;
alter table public.system_heartbeats enable row level security;

create policy evidence_collection_runs_agency_read on public.evidence_collection_runs
  for select to authenticated using (public.is_agency_member(agency_id));
create policy project_evidence_policies_agency_read on public.project_evidence_policies
  for select to authenticated using (public.is_agency_member(agency_id));
create policy project_evidence_policies_admin_write on public.project_evidence_policies
  for all to authenticated
  using (public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
  with check (public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));

revoke all on public.system_heartbeats from anon,authenticated;
revoke select (encrypted_secret_reference) on table public.integration_connections from anon,authenticated;
