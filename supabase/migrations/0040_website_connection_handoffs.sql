begin;

create table if not exists public.website_connection_invites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  website_id uuid references public.websites(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  recipient_email text,
  status text not null default 'pending'
    check (status in ('pending','opened','processing','completed','revoked','expired')),
  allowed_methods text[] not null default array['wordpress','shopify','webflow','github'],
  github_installation_id bigint,
  created_by uuid not null references auth.users(id) on delete restrict,
  first_opened_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create index if not exists website_connection_invites_project_status_idx
  on public.website_connection_invites(project_id,status,created_at desc);
create index if not exists website_connection_invites_expiry_idx
  on public.website_connection_invites(expires_at)
  where status in ('pending','opened','processing');

alter table public.website_connection_invites enable row level security;

drop policy if exists website_connection_invites_tenant_read on public.website_connection_invites;
create policy website_connection_invites_tenant_read
  on public.website_connection_invites for select to authenticated
  using (
    public.is_agency_member(agency_id)
    or public.has_client_access(agency_id,client_organization_id)
  );

revoke all on public.website_connection_invites from anon;
revoke insert,update,delete on public.website_connection_invites from authenticated;
grant select on public.website_connection_invites to authenticated;

comment on table public.website_connection_invites is
  'One-project, expiring handoff grants for a trusted website builder to configure publishing access without entering an HD SEO tenant portal.';
comment on column public.website_connection_invites.token_hash is
  'SHA-256 digest of the bearer token. The raw invitation token is never stored.';

commit;
