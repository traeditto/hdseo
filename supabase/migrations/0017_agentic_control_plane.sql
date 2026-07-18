-- HD SEO agent-first operating environment.
-- Agents are durable, tenant-scoped workers with explicit tools, budgets,
-- evidence, approvals, validation, and outcomes. They are not open chatbots.

create table public.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references public.agencies(id) on delete cascade,
  agent_key text not null,
  name text not null,
  description text not null,
  version text not null default '1.0',
  capabilities jsonb not null default '[]',
  operating_instructions jsonb not null default '{}',
  default_risk_ceiling text not null default 'medium' check(default_risk_ceiling in ('low','medium','high','critical')),
  status text not null default 'active' check(status in ('active','disabled','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index agent_definitions_system_key on public.agent_definitions(agent_key) where agency_id is null;
create unique index agent_definitions_agency_key on public.agent_definitions(agency_id,agent_key) where agency_id is not null;

create table public.agent_tools (
  tool_key text primary key,
  name text not null,
  description text not null,
  provider text not null,
  operation_type text not null check(operation_type in ('read','analyze','draft','write','deploy','rollback','notify')),
  default_risk_level text not null check(default_risk_level in ('low','medium','high','critical')),
  paid boolean not null default false,
  destructive boolean not null default false,
  secret_scope text,
  status text not null default 'active' check(status in ('active','disabled')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_tool_grants (
  id uuid primary key default gen_random_uuid(),
  agent_definition_id uuid not null references public.agent_definitions(id) on delete cascade,
  tool_key text not null references public.agent_tools(tool_key) on delete cascade,
  permission text not null default 'use' check(permission in ('use','request_only','denied')),
  spending_limit numeric(12,4),
  approval_required boolean not null default false,
  constraints jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(agent_definition_id,tool_key)
);

create table public.agent_work_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  parent_work_item_id uuid references public.agent_work_items(id) on delete set null,
  work_type text not null,
  goal text not null,
  assigned_agent_key text not null,
  supervisor_agent_key text not null default 'supervisor',
  status text not null default 'queued' check(status in ('queued','planning','awaiting_approval','waiting_for_tools','running','validating','succeeded','blocked','failed','cancelled','dead_letter')),
  priority smallint not null default 50 check(priority between 0 and 100),
  risk_level text not null default 'low' check(risk_level in ('low','medium','high','critical')),
  evidence jsonb not null default '{}',
  proposed_plan jsonb not null default '{}',
  authorized_tools text[] not null default '{}',
  spending_limit numeric(12,4) not null default 0 check(spending_limit >= 0),
  spent_amount numeric(12,4) not null default 0 check(spent_amount >= 0),
  required_approvals jsonb not null default '[]',
  execution_context jsonb not null default '{}',
  validation_results jsonb not null default '{}',
  final_outcome jsonb not null default '{}',
  source_type text,
  source_id text,
  idempotency_key text not null,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agency_id,idempotency_key)
);

create table public.agent_work_steps (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.agent_work_items(id) on delete cascade,
  sequence int not null check(sequence > 0),
  agent_key text not null,
  step_type text not null,
  title text not null,
  status text not null default 'pending' check(status in ('pending','ready','running','waiting','awaiting_approval','succeeded','failed','skipped','cancelled')),
  tool_key text references public.agent_tools(tool_key),
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  evidence_refs jsonb not null default '[]',
  validation jsonb not null default '{}',
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(work_item_id,sequence)
);

create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  work_item_id uuid not null references public.agent_work_items(id) on delete cascade,
  step_id uuid references public.agent_work_steps(id) on delete cascade,
  approval_type text not null check(approval_type in ('agency','client','technical','risk','spending','publishing','deployment','dns','legal','pricing','destructive')),
  title text not null,
  summary text not null,
  risk_level text not null check(risk_level in ('low','medium','high','critical')),
  requested_decision jsonb not null default '{}',
  status text not null default 'awaiting' check(status in ('awaiting','approved','rejected','expired','cancelled')),
  requested_by_agent_key text not null,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decision_note text,
  requested_at timestamptz not null default now(),
  expires_at timestamptz,
  decided_at timestamptz,
  unique(work_item_id,approval_type,status)
);

create table public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.seo_projects(id) on delete cascade,
  agent_key text not null,
  memory_scope text not null check(memory_scope in ('agency','client','project','work_item')),
  memory_key text not null,
  memory_type text not null check(memory_type in ('fact','preference','decision','evidence_summary','outcome','lesson')),
  content jsonb not null,
  evidence_refs jsonb not null default '[]',
  confidence numeric(5,4) not null default 1 check(confidence between 0 and 1),
  sensitivity text not null default 'internal' check(sensitivity in ('public','internal','confidential','restricted')),
  source_work_item_id uuid references public.agent_work_items(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agency_id,client_id,project_id,agent_key,memory_scope,memory_key)
);
create unique index agent_memory_scope_key on public.agent_memory(agency_id,coalesce(client_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),agent_key,memory_scope,memory_key);

create table public.agent_tool_executions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid not null references public.seo_projects(id) on delete cascade,
  work_item_id uuid not null references public.agent_work_items(id) on delete cascade,
  step_id uuid references public.agent_work_steps(id) on delete set null,
  agent_key text not null,
  tool_key text not null references public.agent_tools(tool_key),
  status text not null default 'requested' check(status in ('requested','authorized','running','succeeded','failed','denied','cancelled')),
  risk_level text not null check(risk_level in ('low','medium','high','critical')),
  request_payload jsonb not null default '{}',
  response_summary jsonb not null default '{}',
  cost_amount numeric(12,4) not null default 0,
  idempotency_key text not null,
  error_code text,
  error_message text,
  authorized_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(work_item_id,idempotency_key)
);

create table public.agent_activity_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.seo_projects(id) on delete cascade,
  work_item_id uuid references public.agent_work_items(id) on delete cascade,
  step_id uuid references public.agent_work_steps(id) on delete set null,
  agent_key text not null,
  event_type text not null,
  title text not null,
  description text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create index agent_work_items_agency_status on public.agent_work_items(agency_id,status,priority desc,created_at);
create index agent_work_items_project_time on public.agent_work_items(project_id,created_at desc);
create index agent_work_steps_item_sequence on public.agent_work_steps(work_item_id,sequence);
create index agent_approvals_agency_status on public.agent_approvals(agency_id,status,requested_at);
create index agent_memory_project_agent on public.agent_memory(project_id,agent_key,updated_at desc);
create index agent_tool_executions_item on public.agent_tool_executions(work_item_id,created_at);
create index agent_activity_project_time on public.agent_activity_events(project_id,occurred_at desc);

insert into public.agent_definitions(agent_key,name,description,capabilities,default_risk_ceiling,operating_instructions) values
('onboarding','Onboarding Agent','Builds the structured business and integration profile used by every other agent.','["detect_business","detect_platform","map_services","map_locations","check_integrations"]','low','{"mustUseEvidence":true,"mayPublish":false}'),
('research','Research Agent','Discovers keywords, competitors, gaps, and high-value opportunities.','["keyword_research","competitor_research","gap_analysis","opportunity_scoring"]','medium','{"mustRespectBudget":true,"paidToolsRequireBudget":true}'),
('strategy','Strategy Agent','Turns evidence and budget into prioritized 30, 60, and 90-day plans.','["prioritize","plan","budget_allocation","dependency_mapping"]','medium','{"mustExplainValue":true,"mayPublish":false}'),
('technical_seo','Technical SEO Agent','Audits indexing, metadata, schema, sitemaps, links, and performance.','["crawl","technical_audit","indexing_audit","performance_audit"]','medium','{"readBeforeWrite":true,"highRiskRequiresApproval":true}'),
('content','Content Agent','Creates review-ready service, location, and supporting content.','["content_brief","content_draft","metadata_draft","internal_links"]','medium','{"claimsRequireEvidence":true,"publishingRequiresPolicy":true}'),
('local_seo','Local SEO Agent','Plans local visibility, service-area, profile, and review improvements.','["local_research","location_gaps","profile_recommendations","review_strategy"]','medium','{"claimsRequireEvidence":true,"profileWritesRequireApproval":true}'),
('implementation','Implementation Agent','Publishes approved changes through connected CMS and repository tools.','["cms_write","repository_write","deploy","rollback"]','high','{"approvalBeforeWrite":true,"rollbackRequired":true}'),
('qa','QA Agent','Validates deployments, SEO, schema, sitemaps, robots, links, and rollback readiness.','["health_check","lighthouse","seo_validation","schema_validation","rollback_validation"]','high','{"independentValidation":true,"mayRollbackOnRequiredFailure":true}'),
('reporting','Reporting Agent','Explains work, rankings, leads, spending, and value in plain language.','["summarize","attribute_outcomes","report","notify"]','low','{"noUnsupportedClaims":true,"clientLanguage":true}'),
('supervisor','Supervisor Agent','Assigns work, enforces permissions and budgets, coordinates retries, and requests approvals.','["assign","authorize_tools","enforce_budget","enforce_risk","request_approval","retry","dead_letter"]','critical','{"cannotBypassApproval":true,"cannotExposeSecrets":true,"mustAudit":true}')
on conflict do nothing;

insert into public.agent_tools(tool_key,name,description,provider,operation_type,default_risk_level,paid,destructive,secret_scope) values
('website.detect','Detect website','Detect platform and public website characteristics.','hdseo','read','low',false,false,null),
('website.crawl','Crawl website','Collect public pages and technical SEO evidence.','hdseo','analyze','low',false,false,null),
('google.search_console.read','Read Search Console','Read project-authorized Search Console evidence.','google','read','low',false,false,'project'),
('google.business_profile.read','Read Business Profile','Read authorized local business profile evidence.','google','read','low',false,false,'project'),
('google.analytics.read','Read Analytics','Read authorized traffic and conversion evidence.','google','read','low',false,false,'project'),
('keywords.discover','Discover keywords','Use budget-capped provider data to discover opportunities.','dataforseo','analyze','medium',true,false,'agency'),
('competitors.analyze','Analyze competitors','Collect and compare authorized public competitor evidence.','dataforseo','analyze','medium',true,false,'agency'),
('opportunities.score','Score opportunities','Rank evidence-backed work by value, difficulty, confidence, and budget.','hdseo','analyze','low',false,false,null),
('strategy.plan','Build strategy','Create a dependency-aware 30, 60, and 90-day plan.','hdseo','draft','low',false,false,null),
('cms.draft','Draft CMS change','Prepare a CMS change without publishing it.','cms','draft','medium',false,false,'project'),
('cms.publish','Publish CMS change','Publish an approved change to the connected CMS.','cms','write','high',false,true,'project'),
('github.read','Read repository','Read files and repository metadata through the project installation.','github','read','low',false,false,'project'),
('github.write','Write repository','Commit approved code changes through the GitHub App.','github','write','high',false,true,'project'),
('vercel.deploy','Deploy website','Create a preview, staging, or production deployment.','vercel','deploy','high',false,true,'project'),
('vercel.rollback','Rollback deployment','Restore a verified prior production deployment.','vercel','rollback','critical',false,true,'project'),
('dns.write','Change DNS','Apply an explicitly approved DNS change.','dns','write','critical',false,true,'project'),
('pricing.change','Change published pricing','Apply an explicitly approved customer-facing pricing change.','cms','write','critical',false,true,'project'),
('legal.publish','Publish legal copy','Apply explicitly approved legal or compliance copy.','cms','write','critical',false,true,'project'),
('lighthouse.run','Run Lighthouse','Measure performance and page quality.','google','analyze','low',false,false,'project'),
('seo.validate','Validate SEO','Validate metadata, links, indexability, and page requirements.','hdseo','analyze','low',false,false,null),
('schema.validate','Validate schema','Validate structured data.','hdseo','analyze','low',false,false,null),
('sitemap.verify','Verify sitemap','Verify sitemap availability and contents.','hdseo','analyze','low',false,false,null),
('robots.verify','Verify robots','Verify robots policy and indexing readiness.','hdseo','analyze','low',false,false,null),
('report.generate','Generate report','Create an evidence-backed client report.','hdseo','draft','low',false,false,null),
('notification.send','Send notification','Send a reviewed in-app or email notification.','hdseo','notify','medium',false,false,'agency'),
('audit.read','Read audit trail','Read tenant-scoped audit and proof-of-work records.','hdseo','read','low',false,false,null)
on conflict(tool_key) do update set name=excluded.name,description=excluded.description,provider=excluded.provider,operation_type=excluded.operation_type,default_risk_level=excluded.default_risk_level,paid=excluded.paid,destructive=excluded.destructive,secret_scope=excluded.secret_scope,updated_at=now();

insert into public.agent_tool_grants(agent_definition_id,tool_key,permission,approval_required,constraints)
select d.id,g.tool_key,g.permission,g.approval_required,g.constraints from public.agent_definitions d join (values
('onboarding','website.detect','use',false,'{}'::jsonb),('onboarding','website.crawl','use',false,'{}'),('onboarding','google.search_console.read','use',false,'{}'),
('research','google.search_console.read','use',false,'{}'),('research','keywords.discover','use',false,'{"budgetRequired":true}'),('research','competitors.analyze','use',false,'{"budgetRequired":true}'),('research','opportunities.score','use',false,'{}'),
('strategy','opportunities.score','use',false,'{}'),('strategy','strategy.plan','use',false,'{}'),('strategy','audit.read','use',false,'{}'),
('technical_seo','website.crawl','use',false,'{}'),('technical_seo','google.search_console.read','use',false,'{}'),('technical_seo','lighthouse.run','use',false,'{}'),('technical_seo','seo.validate','use',false,'{}'),('technical_seo','schema.validate','use',false,'{}'),('technical_seo','sitemap.verify','use',false,'{}'),('technical_seo','robots.verify','use',false,'{}'),
('content','google.search_console.read','use',false,'{}'),('content','cms.draft','use',false,'{}'),('content','cms.publish','request_only',true,'{"forbidClaimsWithoutEvidence":true}'),
('local_seo','google.search_console.read','use',false,'{}'),('local_seo','google.business_profile.read','use',false,'{}'),('local_seo','strategy.plan','use',false,'{}'),
('implementation','cms.draft','use',false,'{}'),('implementation','cms.publish','request_only',true,'{}'),('implementation','github.read','use',false,'{}'),('implementation','github.write','request_only',true,'{}'),('implementation','vercel.deploy','request_only',true,'{}'),('implementation','vercel.rollback','request_only',true,'{}'),('implementation','dns.write','request_only',true,'{}'),('implementation','pricing.change','request_only',true,'{}'),('implementation','legal.publish','request_only',true,'{}'),
('qa','lighthouse.run','use',false,'{}'),('qa','seo.validate','use',false,'{}'),('qa','schema.validate','use',false,'{}'),('qa','sitemap.verify','use',false,'{}'),('qa','robots.verify','use',false,'{}'),('qa','vercel.rollback','request_only',true,'{}'),
('reporting','google.search_console.read','use',false,'{}'),('reporting','google.analytics.read','use',false,'{}'),('reporting','report.generate','use',false,'{}'),('reporting','notification.send','request_only',true,'{}'),('reporting','audit.read','use',false,'{}'),
('supervisor','audit.read','use',false,'{}'),('supervisor','opportunities.score','use',false,'{}'),('supervisor','strategy.plan','use',false,'{}')
) as g(agent_key,tool_key,permission,approval_required,constraints) on d.agent_key=g.agent_key and d.agency_id is null
on conflict(agent_definition_id,tool_key) do update set permission=excluded.permission,approval_required=excluded.approval_required,constraints=excluded.constraints;

create or replace function public.enqueue_agent_work_item(
  p_agency_id uuid,p_client_id uuid,p_project_id uuid,p_work_type text,p_goal text,p_agent_key text,
  p_evidence jsonb,p_proposed_plan jsonb,p_authorized_tools text[],p_spending_limit numeric,p_risk_level text,
  p_required_approvals jsonb,p_priority int,p_idempotency_key text,p_requested_by uuid,p_source_type text default null,p_source_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_work_id uuid;v_job_id uuid;v_invalid_tool text;v_organization_id uuid;v_ceiling text;
begin
  select organization_id into v_organization_id from public.clients where id=p_client_id and agency_id=p_agency_id;
  if v_organization_id is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not exists(select 1 from public.seo_projects where id=p_project_id and agency_id=p_agency_id and client_organization_id=v_organization_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  select default_risk_ceiling into v_ceiling from public.agent_definitions where agent_key=p_agent_key and status='active' and agency_id is null;
  if v_ceiling is null then raise exception 'AGENT_NOT_FOUND'; end if;
  if array_position(array['low','medium','high','critical'],p_risk_level)>array_position(array['low','medium','high','critical'],v_ceiling) then raise exception 'AGENT_RISK_CEILING_EXCEEDED'; end if;
  if p_requested_by is not null and not exists(select 1 from public.agency_members where agency_id=p_agency_id and user_id=p_requested_by and status='active') then raise exception 'REQUESTER_NOT_AUTHORIZED'; end if;
  select tool into v_invalid_tool from unnest(coalesce(p_authorized_tools,'{}')) tool where not exists(
    select 1 from public.agent_tool_grants g join public.agent_definitions d on d.id=g.agent_definition_id
    where d.agent_key=p_agent_key and d.agency_id is null and g.tool_key=tool and g.permission<>'denied'
  ) limit 1;
  if v_invalid_tool is not null then raise exception 'TOOL_NOT_AUTHORIZED:%',v_invalid_tool; end if;
  if exists(
    select 1 from unnest(coalesce(p_authorized_tools,'{}')) tool
    join public.agent_tool_grants g on g.tool_key=tool and g.approval_required
    join public.agent_definitions d on d.id=g.agent_definition_id and d.agent_key=p_agent_key and d.agency_id is null
  ) and jsonb_array_length(coalesce(p_required_approvals,'[]'))=0 then raise exception 'APPROVAL_REQUIRED'; end if;
  select id into v_work_id from public.agent_work_items where agency_id=p_agency_id and idempotency_key=p_idempotency_key;
  if v_work_id is not null then return jsonb_build_object('workItemId',v_work_id,'duplicate',true); end if;
  insert into public.agent_work_items(agency_id,client_id,project_id,work_type,goal,assigned_agent_key,status,priority,risk_level,evidence,proposed_plan,authorized_tools,spending_limit,required_approvals,source_type,source_id,idempotency_key,requested_by)
  values(p_agency_id,p_client_id,p_project_id,p_work_type,p_goal,p_agent_key,'queued',greatest(0,least(p_priority,100)),p_risk_level,coalesce(p_evidence,'{}'),coalesce(p_proposed_plan,'{}'),coalesce(p_authorized_tools,'{}'),greatest(0,coalesce(p_spending_limit,0)),coalesce(p_required_approvals,'[]'),p_source_type,p_source_id,p_idempotency_key,p_requested_by)
  returning id into v_work_id;
  insert into public.agent_work_steps(work_item_id,sequence,agent_key,step_type,title,status,input)
  values(v_work_id,1,'supervisor','supervisor.plan','Review evidence, budget, permissions, and risk','ready',jsonb_build_object('assignedAgent',p_agent_key));
  insert into public.agent_activity_events(agency_id,client_id,project_id,work_item_id,agent_key,event_type,title,description)
  values(p_agency_id,p_client_id,p_project_id,v_work_id,'supervisor','work_item.created','Work assigned',p_goal);
  insert into public.background_jobs(queue,job_type,agency_id,client_organization_id,project_id,payload,status,priority,idempotency_key)
  values('agents','agent.supervise',p_agency_id,v_organization_id,p_project_id,jsonb_build_object('workItemId',v_work_id),'queued',greatest(0,least(p_priority,100)),'agent.supervise:'||v_work_id)
  returning id into v_job_id;
  return jsonb_build_object('workItemId',v_work_id,'backgroundJobId',v_job_id,'duplicate',false);
end $$;

alter table public.audit_events drop constraint if exists audit_events_actor_type_check;
alter table public.audit_events add constraint audit_events_actor_type_check check(actor_type in ('user','system','agent','github','vercel'));

do $$ declare t text; begin
  foreach t in array array['agent_definitions','agent_tools','agent_tool_grants','agent_work_items','agent_work_steps','agent_approvals','agent_memory','agent_tool_executions','agent_activity_events'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create policy agent_definitions_read on public.agent_definitions for select to authenticated using(agency_id is null or public.is_agency_member(agency_id));
create policy agent_tools_read on public.agent_tools for select to authenticated using(true);
create policy agent_tool_grants_read on public.agent_tool_grants for select to authenticated using(exists(select 1 from public.agent_definitions d where d.id=agent_definition_id and (d.agency_id is null or public.is_agency_member(d.agency_id))));
do $$ declare t text; begin
  foreach t in array array['agent_work_items','agent_approvals','agent_memory','agent_tool_executions','agent_activity_events'] loop
    execute format('create policy %I_member_read on public.%I for select to authenticated using(public.is_agency_member(agency_id))',t,t);
  end loop;
end $$;
create policy agent_work_steps_member_read on public.agent_work_steps for select to authenticated using(exists(select 1 from public.agent_work_items w where w.id=work_item_id and public.is_agency_member(w.agency_id)));
create policy agent_approvals_decide on public.agent_approvals for update to authenticated using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[])) with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));

revoke all on function public.enqueue_agent_work_item(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text[],numeric,text,jsonb,int,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_agent_work_item(uuid,uuid,uuid,text,text,text,jsonb,jsonb,text[],numeric,text,jsonb,int,text,uuid,text,text) to service_role;
