-- HD SEO outcomes, attribution, budget, and local/off-site operating control plane.
-- External systems remain sources of evidence; writes and spend are tenant scoped,
-- idempotent, approval gated, and recorded without storing provider secrets here.

alter table public.integration_oauth_states
  drop constraint if exists integration_oauth_states_provider_check;
alter table public.integration_oauth_states
  add constraint integration_oauth_states_provider_check
  check (provider in ('github','vercel','google_search_console','google_business_profile','google_analytics'));

alter table public.webhook_events drop constraint if exists webhook_events_provider_check;
alter table public.webhook_events add constraint webhook_events_provider_check
  check (provider in ('github','vercel','stripe','callrail','hubspot','crm'));

create table public.project_budget_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null unique,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  monthly_limit numeric(14,2) not null default 0 check (monthly_limit >= 0),
  warning_percent numeric(5,2) not null default 80 check (warning_percent between 1 and 100),
  hard_stop boolean not null default true,
  status text not null default 'active' check (status in ('active','paused','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.project_budget_allocations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  budget_account_id uuid not null,
  category text not null check (category in ('data','content','technical','local','authority','implementation','software','reserve')),
  monthly_amount numeric(14,2) not null default 0 check (monthly_amount >= 0),
  approval_threshold numeric(14,2) not null default 0 check (approval_threshold >= 0),
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,category),
  foreign key(agency_id,client_organization_id,project_id,budget_account_id)
    references public.project_budget_accounts(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table public.project_budget_transactions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  budget_account_id uuid not null,
  category text not null check (category in ('data','content','technical','local','authority','implementation','software','reserve')),
  transaction_type text not null check (transaction_type in ('actual','commitment','credit','adjustment')),
  provider text not null, description text not null,
  amount numeric(14,4) not null check (amount >= 0), currency text not null default 'USD',
  external_id text, source_type text, source_id text,
  approval_status text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
  occurred_at timestamptz not null default now(), idempotency_key text not null,
  metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(agency_id,idempotency_key),
  foreign key(agency_id,client_organization_id,project_id,budget_account_id)
    references public.project_budget_accounts(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table public.analytics_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  provider text not null check (provider in ('ga4','search_console','callrail','crm','manual')),
  metric_date date not null, landing_page text not null default '', source text not null default '', medium text not null default '', campaign text not null default '',
  sessions numeric not null default 0, organic_sessions numeric not null default 0,
  conversions numeric not null default 0, phone_calls numeric not null default 0, form_leads numeric not null default 0,
  qualified_leads numeric not null default 0, booked_jobs numeric not null default 0,
  revenue numeric(14,2) not null default 0, gross_profit numeric(14,2) not null default 0,
  metadata jsonb not null default '{}', captured_at timestamptz not null default now(),
  unique(project_id,provider,metric_date,landing_page,source,medium,campaign),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.attribution_touchpoints (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  lead_id uuid references public.seo_leads(id) on delete cascade,
  external_visitor_id text, session_id text, touchpoint_type text not null,
  channel text not null, source text, medium text, campaign text, query text,
  landing_page_url text, referrer_url text, occurred_at timestamptz not null,
  attribution_weight numeric(7,6) not null default 0 check (attribution_weight between 0 and 1),
  model text not null default 'evidence_only' check (model in ('first_touch','last_touch','linear','position_based','evidence_only')),
  evidence jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.local_business_profiles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  connection_id uuid references public.integration_connections(id) on delete set null,
  external_account_id text, external_location_id text not null, title text not null,
  primary_category text, additional_categories jsonb not null default '[]',
  address jsonb not null default '{}', phone text, website_url text,
  regular_hours jsonb not null default '{}', special_hours jsonb not null default '{}',
  service_area jsonb not null default '{}', attributes jsonb not null default '{}',
  verification_state text, profile_completeness numeric(5,2) not null default 0 check (profile_completeness between 0 and 100),
  status text not null default 'active' check (status in ('active','unverified','suspended','closed')),
  raw_fingerprint text, last_synced_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,external_location_id),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.local_reviews (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  profile_id uuid not null, provider text not null default 'google', external_review_id text not null,
  reviewer_name text, star_rating numeric(2,1) check (star_rating between 1 and 5), comment text,
  reply_text text, replied_at timestamptz, review_created_at timestamptz, review_updated_at timestamptz,
  sentiment text check (sentiment is null or sentiment in ('positive','neutral','negative','mixed')),
  topics text[] not null default '{}', response_status text not null default 'unanswered' check (response_status in ('unanswered','drafted','approved','published','not_needed')),
  metadata jsonb not null default '{}', captured_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(profile_id,external_review_id),
  foreign key(agency_id,client_organization_id,project_id,profile_id)
    references public.local_business_profiles(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table public.local_profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  profile_id uuid not null, change_type text not null check (change_type in ('hours','special_hours','phone','website','service_area','categories','attributes')),
  current_value jsonb not null default 'null', proposed_value jsonb not null,
  update_mask text not null, rationale text not null, evidence jsonb not null default '{}',
  risk_level text not null default 'high' check (risk_level in ('medium','high','critical')),
  status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','publishing','published','failed','rejected')),
  idempotency_key text not null, requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
  published_at timestamptz, provider_response jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(agency_id,idempotency_key),
  foreign key(agency_id,client_organization_id,project_id,profile_id)
    references public.local_business_profiles(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table public.citation_listings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  provider text not null, directory_name text not null, listing_url text, external_id text,
  name text, address text, phone text, website_url text,
  nap_consistent boolean, claimed boolean, status text not null default 'discovered' check (status in ('discovered','needs_claim','needs_correction','consistent','submitted','verified','unavailable')),
  issue_codes text[] not null default '{}', evidence jsonb not null default '{}',
  last_checked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,provider,directory_name),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.authority_outreach_actions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  authority_opportunity_id uuid references public.authority_opportunities(id) on delete set null,
  contact_name text, contact_email text, organization text, target_url text,
  outreach_type text not null check (outreach_type in ('expert_quote','resource_suggestion','partnership','sponsorship','association','unlinked_mention','digital_pr')),
  subject text, message text, status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','sent','replied','earned','declined','bounced','cancelled')),
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  estimated_cost numeric(14,2) not null default 0 check (estimated_cost >= 0),
  approval_id uuid, external_message_id text, sent_at timestamptz, replied_at timestamptz,
  evidence jsonb not null default '{}', idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(agency_id,idempotency_key),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  connection_id uuid references public.integration_connections(id) on delete set null,
  provider text not null, operation text not null,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  records_read int not null default 0, records_written int not null default 0,
  error_code text, error_message text, metadata jsonb not null default '{}',
  started_at timestamptz not null default now(), completed_at timestamptz,
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create index budget_transactions_project_month on public.project_budget_transactions(project_id,occurred_at desc);
create index analytics_daily_project_date on public.analytics_daily_metrics(project_id,metric_date desc);
create index attribution_project_time on public.attribution_touchpoints(project_id,occurred_at desc);
create index local_reviews_project_time on public.local_reviews(project_id,review_created_at desc);
create index local_profile_changes_project_status on public.local_profile_change_requests(project_id,status,created_at desc);
create index citations_project_status on public.citation_listings(project_id,status,updated_at desc);
create index authority_outreach_project_status on public.authority_outreach_actions(project_id,status,created_at desc);
create index provider_sync_project_time on public.provider_sync_runs(project_id,started_at desc);

do $$ declare t text; begin
  foreach t in array array['project_budget_accounts','project_budget_allocations','project_budget_transactions','analytics_daily_metrics','attribution_touchpoints','local_business_profiles','local_reviews','local_profile_change_requests','citation_listings','authority_outreach_actions','provider_sync_runs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I_tenant_read on public.%I for select to authenticated using(public.has_client_access(agency_id,client_organization_id))',t,t);
  end loop;
end $$;

create policy budget_accounts_agency_write on public.project_budget_accounts for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy budget_allocations_agency_write on public.project_budget_allocations for all to authenticated
  using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
  with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));

revoke insert,update,delete on public.project_budget_transactions from anon,authenticated;
revoke insert,update,delete on public.analytics_daily_metrics from anon,authenticated;
revoke insert,update,delete on public.attribution_touchpoints from anon,authenticated;
revoke insert,update,delete on public.local_business_profiles from anon,authenticated;
revoke insert,update,delete on public.local_reviews from anon,authenticated;
revoke insert,update,delete on public.local_profile_change_requests from anon,authenticated;
revoke insert,update,delete on public.citation_listings from anon,authenticated;
revoke insert,update,delete on public.authority_outreach_actions from anon,authenticated;
revoke insert,update,delete on public.provider_sync_runs from anon,authenticated;

insert into public.agent_tools(tool_key,name,description,provider,operation_type,default_risk_level,paid,destructive,secret_scope) values
('analytics.ga4.sync','Sync GA4 outcomes','Import organic sessions and configured conversion events.','google','read','low',false,false,'project'),
('local.profile.sync','Sync Business Profile','Import authorized locations, profile completeness, and reviews.','google','read','low',false,false,'project'),
('local.profile.write','Update Business Profile','Apply an explicitly approved profile field update.','google','write','high',false,true,'project'),
('reviews.reply','Publish review reply','Publish an approved owner response to a customer review.','google','write','high',false,true,'project'),
('citations.audit','Audit citations','Compare NAP data across approved listing providers.','citations','analyze','low',true,false,'project'),
('leads.sync','Sync calls and leads','Import call and CRM outcomes without making attribution claims beyond evidence.','attribution','read','low',false,false,'project'),
('budget.record','Record SEO spend','Record actual or committed spend against a tenant budget.','hdseo','write','medium',false,false,'project'),
('authority.outreach','Send authority outreach','Send a reviewed, non-spam outreach message for a qualified opportunity.','email','notify','high',true,false,'project')
on conflict(tool_key) do update set name=excluded.name,description=excluded.description,provider=excluded.provider,operation_type=excluded.operation_type,default_risk_level=excluded.default_risk_level,paid=excluded.paid,destructive=excluded.destructive,secret_scope=excluded.secret_scope,updated_at=now();

insert into public.agent_tool_grants(agent_definition_id,tool_key,permission,approval_required,constraints)
select d.id,g.tool_key,g.permission,g.approval_required,g.constraints from public.agent_definitions d join(values
('reporting','analytics.ga4.sync','use',false,'{}'::jsonb),('reporting','leads.sync','use',false,'{}'),('reporting','budget.record','use',false,'{}'),
('local_seo','local.profile.sync','use',false,'{}'),('local_seo','local.profile.write','request_only',true,'{}'),('local_seo','reviews.reply','request_only',true,'{}'),('local_seo','citations.audit','use',false,'{"budgetRequired":true}'),
('strategy','budget.record','use',false,'{}'),('strategy','analytics.ga4.sync','use',false,'{}'),
('research','citations.audit','use',false,'{"budgetRequired":true}'),('research','leads.sync','use',false,'{}'),
('implementation','local.profile.write','request_only',true,'{}'),('implementation','reviews.reply','request_only',true,'{}'),('implementation','authority.outreach','request_only',true,'{}'),
('supervisor','budget.record','use',false,'{}')
)as g(agent_key,tool_key,permission,approval_required,constraints) on d.agent_key=g.agent_key and d.agency_id is null
on conflict(agent_definition_id,tool_key) do update set permission=excluded.permission,approval_required=excluded.approval_required,constraints=excluded.constraints;
