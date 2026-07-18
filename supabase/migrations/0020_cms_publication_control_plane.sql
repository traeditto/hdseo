-- Provider-native CMS publication and rollback ledger.
-- Every external write is idempotent, tenant-scoped, and retains the exact
-- before/after state required to reverse the change safely.

create table public.cms_publications (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  package_id uuid not null references public.implementation_packages(id) on delete restrict,
  connection_id uuid not null references public.cms_connections(id) on delete restrict,
  provider text not null check (provider in ('wordpress','shopify','webflow')),
  provider_resource_type text not null,
  provider_resource_id text,
  target_url text not null,
  status text not null default 'queued' check (status in ('queued','publishing','published','publish_failed','rolling_back','rolled_back','rollback_failed')),
  idempotency_key text not null,
  before_snapshot jsonb not null default '{}',
  after_snapshot jsonb not null default '{}',
  provider_result jsonb not null default '{}',
  error_code text,
  error_message text,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete set null,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id,idempotency_key),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create index cms_publications_project_time_idx
  on public.cms_publications(project_id,created_at desc);
create index cms_publications_package_time_idx
  on public.cms_publications(package_id,created_at desc);
create index cms_publications_status_time_idx
  on public.cms_publications(status,updated_at);

alter table public.cms_publications enable row level security;

create policy cms_publications_agency_read on public.cms_publications
  for select to authenticated using (public.is_agency_member(agency_id));

revoke insert,update,delete on public.cms_publications from anon,authenticated;
