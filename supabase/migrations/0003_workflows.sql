create type public.seo_action_type as enum ('BUILD','IMPROVE','LINK','LOCALIZE','DEFEND','TECHNICAL','CONTENT','MAPS');

create table public.seo_opportunities (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  keyword_id uuid, opportunity_score smallint not null check (opportunity_score between 0 and 100), confidence_score smallint not null check (confidence_score between 0 and 100),
  action_type public.seo_action_type not null, priority text not null, target_milestone text not null, reason_codes text[] not null default '{}', evidence jsonb not null default '{}', recommended_actions jsonb not null default '[]', status text not null default 'open', scoring_version text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (agency_id, client_organization_id, project_id, id),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.seo_action_drafts (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null, opportunity_id uuid not null,
  execution_path text not null check (execution_path in ('repository','instruction')), status text not null default 'draft', target_url text, suggested_url text,
  title_suggestion text, meta_description_suggestion text, content_brief jsonb not null default '{}', internal_link_recommendations jsonb not null default '[]', schema_recommendations jsonb not null default '[]', technical_instructions jsonb not null default '[]', evidence_snapshot jsonb not null,
  assigned_to uuid references auth.users(id), due_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), approved_at timestamptz, completed_at timestamptz,
  foreign key (agency_id, client_organization_id, project_id, opportunity_id) references public.seo_opportunities(agency_id, client_organization_id, project_id, id) on delete cascade
);

create table public.seo_tasks (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  draft_id uuid references public.seo_action_drafts(id) on delete set null, title text not null, status text not null default 'backlog', priority text not null default 'medium', assigned_to uuid references auth.users(id), due_at timestamptz,
  internal_notes text, client_visible_notes text, completion_proof jsonb, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (agency_id, client_organization_id, project_id) references public.seo_projects(agency_id, client_organization_id, id) on delete cascade
);

create table public.data_provider_connections (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null references public.agencies(id) on delete cascade, provider text not null, connection_type text not null, status text not null default 'pending', encrypted_secret_reference text, last_verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(agency_id, provider)
);

create table public.data_usage_events (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null, client_organization_id uuid, project_id uuid, provider text not null, operation_type text not null, requested_by uuid not null references auth.users(id), confirmation_id uuid not null, units numeric not null default 0, estimated_cost numeric(12,4), actual_cost numeric(12,4), status text not null, created_at timestamptz not null default now(),
  foreign key (agency_id) references public.agencies(id) on delete restrict
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), agency_id uuid, client_organization_id uuid, project_id uuid, actor_user_id uuid references auth.users(id), action text not null, object_type text not null, object_id uuid, before_summary jsonb, after_summary jsonb, request_metadata jsonb, created_at timestamptz not null default now()
);

revoke update, delete on public.audit_logs from authenticated;
