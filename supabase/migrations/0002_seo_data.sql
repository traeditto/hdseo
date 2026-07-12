create table public.seo_projects (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null,
  name text not null, domain text not null, canonical_domain text not null, industry text, country_code char(2) not null default 'US', language_code text not null default 'en', primary_market text, timezone text not null default 'UTC',
  status text not null default 'active', data_readiness_status text not null default 'not_started',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (agency_id, id), unique (agency_id, client_organization_id, id),
  foreign key (agency_id, client_organization_id) references public.client_organizations(agency_id, id) on delete cascade
);

create table public.seo_services (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  name text not null, slug text not null, category text, priority smallint not null default 50 check (priority between 0 and 100), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (agency_id, client_organization_id, project_id, id),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_locations (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  name text not null, city text, county text, state text, postal_code text, country_code char(2) not null default 'US', latitude numeric(9,6), longitude numeric(9,6), priority smallint not null default 50, status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (agency_id, client_organization_id, project_id, id),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_keywords (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  service_id uuid, location_id uuid, keyword text not null, normalized_keyword text not null, intent text, commercial_intent_score smallint check (commercial_intent_score between 0 and 100), target_url text, status text not null default 'active', priority smallint not null default 50,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (agency_id, client_organization_id, project_id, id),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.keyword_metrics (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null, keyword_id uuid not null,
  search_volume integer, cpc numeric(12,2), competition numeric(6,5), difficulty smallint, source text not null, collected_at timestamptz not null,
  foreign key (agency_id, client_organization_id, project_id, keyword_id) references public.seo_keywords(agency_id, client_organization_id, project_id, id) on delete cascade
);

create table public.organic_ranking_snapshots (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null, keyword_id uuid not null,
  position numeric(6,2), ranking_url text, search_engine text not null default 'google', device text not null default 'desktop', location_code text, collected_at timestamptz not null,
  foreign key (agency_id, client_organization_id, project_id, keyword_id) references public.seo_keywords(agency_id, client_organization_id, project_id, id) on delete cascade
);

create index ranking_keyword_time_idx on public.organic_ranking_snapshots(keyword_id, collected_at desc);
