-- HD SEO Local Growth Engine.
-- Adds durable brand memory, value-gated 30/60/90-day planning, internal-link
-- intelligence, content refresh, AI visibility, earned-authority research,
-- interactive tool specifications, and verifiable outcome snapshots.

create table public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null unique,
  business_summary text not null default '',
  target_audiences jsonb not null default '[]',
  tone_attributes text[] not null default '{}',
  preferred_vocabulary text[] not null default '{}',
  prohibited_vocabulary text[] not null default '{}',
  reading_level text not null default 'plain_language',
  brand_values jsonb not null default '[]',
  style_rules jsonb not null default '{}',
  visual_identity jsonb not null default '{}',
  approved_examples jsonb not null default '[]',
  source_urls text[] not null default '{}',
  profile_version int not null default 1 check (profile_version > 0),
  status text not null default 'draft' check (status in ('draft','ready','approved','archived')),
  learned_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.growth_plans (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  version int not null default 1 check (version > 0),
  period_start date not null default current_date,
  horizon_days int not null default 90 check (horizon_days in (30,60,90)),
  monthly_budget numeric(12,2) not null default 0 check (monthly_budget >= 0),
  strategy_summary text not null,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','active','completed','archived')),
  value_model jsonb not null default '{}',
  generated_by text not null default 'strategy_agent',
  generated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,version),
  unique (agency_id,client_organization_id,project_id,id),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.growth_plan_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  plan_id uuid not null,
  opportunity_id uuid,
  sequence int not null check (sequence > 0),
  phase_days int not null check (phase_days in (30,60,90)),
  action_type text not null check (action_type in ('BUILD','IMPROVE','LINK','LOCALIZE','DEFEND','TECHNICAL','CONTENT','MAPS','CONVERSION','REFRESH','AUTHORITY','AI_VISIBILITY','TOOL')),
  title text not null,
  target_keyword text,
  target_url text,
  service_id uuid,
  location_id uuid,
  scheduled_for date,
  priority_score numeric(6,2) not null default 0 check (priority_score between 0 and 100),
  expected_value jsonb not null default '{}',
  evidence jsonb not null default '{}',
  dependencies jsonb not null default '[]',
  acceptance_criteria jsonb not null default '[]',
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  approval_required boolean not null default true,
  status text not null default 'proposed' check (status in ('proposed','awaiting_approval','approved','scheduled','in_progress','completed','blocked','skipped')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id,sequence),
  foreign key (agency_id,client_organization_id,project_id,plan_id)
    references public.growth_plans(agency_id,client_organization_id,project_id,id) on delete cascade,
  foreign key (agency_id,client_organization_id,project_id,opportunity_id)
    references public.seo_opportunities(agency_id,client_organization_id,project_id,id) on delete set null,
  foreign key (agency_id,client_organization_id,project_id,service_id)
    references public.seo_services(agency_id,client_organization_id,project_id,id) on delete set null,
  foreign key (agency_id,client_organization_id,project_id,location_id)
    references public.seo_locations(agency_id,client_organization_id,project_id,id) on delete set null
);

create table public.internal_link_edges (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  source_url text not null,
  target_url text not null,
  anchor_text text,
  relationship text not null default 'contextual' check (relationship in ('contextual','navigation','supporting_to_owner','owner_to_supporting')),
  status text not null default 'observed' check (status in ('observed','proposed','approved','published','rejected','broken')),
  relevance_score numeric(5,2) not null default 0 check (relevance_score between 0 and 100),
  source_snapshot_id uuid references public.seo_page_snapshots(id) on delete set null,
  evidence jsonb not null default '{}',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,source_url,target_url,relationship),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  check (source_url <> target_url)
);

create table public.content_refresh_candidates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  target_url text not null,
  owner_keyword text,
  reason_codes text[] not null default '{}',
  performance_before jsonb not null default '{}',
  diagnosis jsonb not null default '{}',
  recommended_changes jsonb not null default '[]',
  expected_value jsonb not null default '{}',
  priority_score numeric(6,2) not null default 0 check (priority_score between 0 and 100),
  status text not null default 'open' check (status in ('open','approved','scheduled','refreshing','validated','dismissed','failed')),
  last_evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,target_url),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.ai_visibility_prompts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  question text not null,
  normalized_question text not null,
  engine text not null check (engine in ('google_ai_overview','gemini','chatgpt','perplexity','other')),
  service_id uuid,
  location_id uuid,
  buyer_stage text not null default 'consideration' check (buyer_stage in ('awareness','consideration','decision')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,normalized_question,engine),
  unique (agency_id,client_organization_id,project_id,id),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  foreign key (agency_id,client_organization_id,project_id,service_id)
    references public.seo_services(agency_id,client_organization_id,project_id,id) on delete set null,
  foreign key (agency_id,client_organization_id,project_id,location_id)
    references public.seo_locations(agency_id,client_organization_id,project_id,id) on delete set null
);

create table public.ai_visibility_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  prompt_id uuid not null,
  client_mentioned boolean not null default false,
  mention_position int check (mention_position is null or mention_position > 0),
  answer_summary text,
  cited_urls jsonb not null default '[]',
  competitor_mentions jsonb not null default '[]',
  response_fingerprint text,
  evidence_source text not null,
  captured_at timestamptz not null default now(),
  foreign key (agency_id,client_organization_id,project_id,prompt_id)
    references public.ai_visibility_prompts(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table public.authority_opportunities (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  opportunity_type text not null check (opportunity_type in ('local_directory','association','supplier','sponsorship','digital_pr','original_data','unlinked_mention','broken_link','expert_quote','partner_resource')),
  title text not null,
  target_domain text,
  target_url text,
  service text,
  location text,
  relevance_score numeric(5,2) not null default 0 check (relevance_score between 0 and 100),
  geographic_fit numeric(5,2) not null default 0 check (geographic_fit between 0 and 100),
  editorial_score numeric(5,2) not null default 0 check (editorial_score between 0 and 100),
  risk_score numeric(5,2) not null default 0 check (risk_score between 0 and 100),
  estimated_cost numeric(12,2) not null default 0 check (estimated_cost >= 0),
  evidence jsonb not null default '{}',
  recommended_action text not null,
  status text not null default 'discovered' check (status in ('discovered','qualified','awaiting_approval','approved','outreach','earned','rejected','expired')),
  discovered_at timestamptz not null default now(),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,opportunity_type,target_url),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.growth_tool_specs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  title text not null,
  slug text not null,
  tool_type text not null check (tool_type in ('calculator','estimator','checker','comparison','generator','decision_tree','interactive_guide')),
  target_keyword text,
  service text,
  location text,
  user_job text not null,
  inputs jsonb not null default '[]',
  output_rules jsonb not null default '{}',
  approved_claim_ids uuid[] not null default '{}',
  conversion_goal jsonb not null default '{}',
  implementation_requirements jsonb not null default '[]',
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  status text not null default 'draft' check (status in ('draft','evidence_needed','ready','approved','building','published','rejected')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,slug),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.case_study_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  title text not null,
  period_start date not null,
  period_end date not null,
  changed_urls jsonb not null default '[]',
  deployment_refs jsonb not null default '[]',
  query_filters jsonb not null default '{}',
  baseline_metrics jsonb not null default '{}',
  outcome_metrics jsonb not null default '{}',
  leads_summary jsonb not null default '{}',
  confounders jsonb not null default '[]',
  verification_links jsonb not null default '[]',
  public_summary text,
  status text not null default 'draft' check (status in ('draft','verified','published','archived')),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  check (period_end >= period_start)
);

create index growth_plans_project_status_idx on public.growth_plans(project_id,status,created_at desc);
create index growth_plan_items_project_status_idx on public.growth_plan_items(project_id,status,phase_days,sequence);
create index internal_link_edges_project_status_idx on public.internal_link_edges(project_id,status,updated_at desc);
create index internal_link_edges_target_idx on public.internal_link_edges(project_id,target_url,status);
create index refresh_candidates_project_score_idx on public.content_refresh_candidates(project_id,status,priority_score desc);
create index ai_visibility_prompts_project_idx on public.ai_visibility_prompts(project_id,active,engine);
create index ai_visibility_snapshots_prompt_time_idx on public.ai_visibility_snapshots(prompt_id,captured_at desc);
create index authority_project_score_idx on public.authority_opportunities(project_id,status,relevance_score desc);
create index growth_tools_project_status_idx on public.growth_tool_specs(project_id,status,created_at desc);
create index case_studies_project_time_idx on public.case_study_snapshots(project_id,period_end desc);

do $$ declare t text; begin
  foreach t in array array[
    'brand_profiles','growth_plans','growth_plan_items','internal_link_edges',
    'content_refresh_candidates','ai_visibility_prompts','ai_visibility_snapshots',
    'authority_opportunities','growth_tool_specs','case_study_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I_tenant_read on public.%I for select to authenticated using(public.has_client_access(agency_id,client_organization_id))',t,t);
  end loop;
end $$;

-- Mutations flow through tenant-authorized server routes so approval, rate
-- limits, audit events, and idempotency cannot be bypassed from the browser.
do $$ declare t text; begin
  foreach t in array array[
    'brand_profiles','growth_plans','growth_plan_items','internal_link_edges',
    'content_refresh_candidates','ai_visibility_prompts','ai_visibility_snapshots',
    'authority_opportunities','growth_tool_specs','case_study_snapshots'
  ] loop
    execute format('revoke insert,update,delete on public.%I from anon,authenticated',t);
  end loop;
end $$;

insert into public.agent_tools(tool_key,name,description,provider,operation_type,default_risk_level,paid,destructive,secret_scope) values
('brand.profile','Build brand profile','Learn tenant-scoped voice and audience rules without treating style as factual proof.','hdseo','analyze','low',false,false,'project'),
('growth.plan','Build Local Growth Plan','Create a value-gated 30, 60, and 90-day mix of technical, local, content, conversion, and authority work.','hdseo','draft','low',false,false,'project'),
('internal_links.graph','Analyze internal-link graph','Find orphaned owner pages and propose relevant contextual links without creating loops or cannibalization.','hdseo','analyze','low',false,false,'project'),
('content.refresh','Evaluate content refresh','Detect evidence-backed content decay and recommend updating an existing owner page before creating a duplicate.','hdseo','analyze','low',false,false,'project'),
('ai_visibility.observe','Observe AI visibility','Record buyer-question mentions and citations as observational evidence without claiming causation.','hdseo','analyze','low',false,false,'project'),
('authority.research','Research earned authority','Find legitimate editorial, local, association, supplier, original-data, and mention-reclamation opportunities.','hdseo','analyze','medium',false,false,'project'),
('growth_tool.spec','Specify useful interactive tool','Design an evidence-gated calculator, checker, estimator, or guide that serves a real customer job.','hdseo','draft','medium',false,false,'project'),
('proof.case_study','Build verifiable case study','Compile live URLs, query filters, baselines, outcomes, confounders, leads, and deployment evidence.','hdseo','draft','low',false,false,'project')
on conflict(tool_key) do update set
  name=excluded.name,description=excluded.description,provider=excluded.provider,
  operation_type=excluded.operation_type,default_risk_level=excluded.default_risk_level,
  paid=excluded.paid,destructive=excluded.destructive,secret_scope=excluded.secret_scope,updated_at=now();

insert into public.agent_tool_grants(agent_definition_id,tool_key,permission,approval_required,constraints)
select d.id,g.tool_key,g.permission,g.approval_required,g.constraints
from public.agent_definitions d join(values
  ('onboarding','brand.profile','use',false,'{}'::jsonb),
  ('strategy','growth.plan','use',false,'{"valueGated":true,"serviceAreaRequired":true}'),
  ('technical_seo','internal_links.graph','use',false,'{}'),
  ('content','internal_links.graph','use',false,'{}'),
  ('content','content.refresh','use',false,'{"preferExistingOwnerPage":true}'),
  ('research','ai_visibility.observe','use',false,'{"observationalOnly":true}'),
  ('research','authority.research','use',false,'{"forbidAutomatedLinkExchange":true}'),
  ('content','growth_tool.spec','use',false,'{"verifiedClaimsRequired":true}'),
  ('reporting','proof.case_study','use',false,'{"causationClaimsRequireEvidence":true}'),
  ('supervisor','growth.plan','use',false,'{"approvalBeforeWrite":true}')
) as g(agent_key,tool_key,permission,approval_required,constraints)
on d.agent_key=g.agent_key and d.agency_id is null
on conflict(agent_definition_id,tool_key) do update set
  permission=excluded.permission,approval_required=excluded.approval_required,constraints=excluded.constraints;
