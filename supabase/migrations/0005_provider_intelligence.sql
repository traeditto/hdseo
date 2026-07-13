create table public.provider_operation_confirmations (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null, project_id uuid not null, provider text not null, operation_type text not null,
  requested_by uuid not null references auth.users(id), estimated_units numeric not null default 0,
  estimated_cost numeric(12,4) not null default 0, scope jsonb not null default '{}', confirmed_at timestamptz not null default now(), expires_at timestamptz not null,
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.provider_job_locks (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null references public.agencies(id) on delete cascade,
  project_id uuid not null, operation_type text not null, lock_key text not null unique, worker_id text,
  locked_at timestamptz not null default now(), expires_at timestamptz not null, created_at timestamptz not null default now(),
  unique(agency_id, project_id, operation_type),
  foreign key (agency_id, project_id) references public.seo_projects(agency_id, id) on delete cascade
);

create table public.keyword_metric_snapshots (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  keyword_id uuid, keyword text not null, search_volume int, cpc numeric(12,4), paid_competition numeric(8,4), competition_level text,
  keyword_difficulty numeric(8,3), search_intent text, serp_features jsonb not null default '[]', source text not null,
  raw_response jsonb not null default '{}', captured_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade,
  foreign key (keyword_id) references public.seo_keywords(id) on delete set null
);

create table public.competitor_domains (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  domain text not null, display_name text, intersections int, average_position numeric(10,3), estimated_traffic numeric(14,4),
  ignored boolean not null default false, raw_response jsonb not null default '{}', first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  unique(project_id, domain), unique(agency_id, client_organization_id, project_id, id),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_page_snapshots (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  url text not null, source_files jsonb not null default '[]', title text, meta_description text, h1 text, headings jsonb not null default '[]',
  internal_links jsonb not null default '[]', schema_types jsonb not null default '[]', assigned_keywords jsonb not null default '[]',
  service_id uuid, location_id uuid, canonical text, source_commit_sha text, captured_at timestamptz not null default now(),
  unique(project_id, url, source_commit_sha),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.maps_rank_snapshots (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  keyword_id uuid, keyword text not null, latitude numeric(10,7), longitude numeric(10,7), rank_position int, found boolean not null,
  matched_name text, matched_domain text, top_competitor_name text, raw_response jsonb not null default '{}', captured_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.site_audits (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  provider_task_id text, target_domain text not null, status text not null, crawl_progress numeric(6,3), requested_page_limit int,
  crawled_pages int, score numeric(8,3), api_cost numeric(12,4) not null default 0, summary jsonb not null default '{}',
  started_at timestamptz, completed_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.audit_findings (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  audit_id uuid not null references public.site_audits(id) on delete cascade, page_url text, finding_type text not null,
  severity text not null check(severity in ('critical','high','medium','low')), title text not null, description text not null,
  evidence jsonb not null default '{}', status text not null default 'open', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create index provider_confirmation_lookup on public.provider_operation_confirmations(agency_id, project_id, expires_at desc);
create index keyword_metric_latest on public.keyword_metric_snapshots(project_id, keyword_id, captured_at desc);
create index page_snapshot_latest on public.seo_page_snapshots(project_id, url, captured_at desc);
create index maps_snapshot_latest on public.maps_rank_snapshots(project_id, keyword_id, captured_at desc);
