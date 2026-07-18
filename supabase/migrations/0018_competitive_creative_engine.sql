-- Evidence-first SEO creative and outcome learning layer.
-- Every operational record is scoped through the existing composite project key.

create table public.business_proof_assets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  proof_type text not null check(proof_type in ('project','photo','voice_note','credential','review','process','material','warranty','pricing_factor','faq','service_area','case_study','other')),
  title text not null, summary text not null, source_url text, storage_path text, mime_type text,
  service text, location text, facts jsonb not null default '{}',
  verification_status text not null default 'unverified' check(verification_status in ('unverified','verified','rejected','expired')),
  captured_by uuid references auth.users(id) on delete set null, verified_by uuid references auth.users(id) on delete set null,
  captured_at timestamptz not null default now(), verified_at timestamptz, expires_at timestamptz,
  sensitivity text not null default 'internal' check(sensitivity in ('public','internal','confidential','restricted')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.business_claims (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  proof_asset_id uuid, claim_text text not null,
  claim_type text not null check(claim_type in ('factual','pricing','legal','credential','warranty','performance','service_area')),
  status text not null default 'pending' check(status in ('pending','verified','rejected','expired')),
  evidence_refs jsonb not null default '[]', risk_level text not null default 'medium' check(risk_level in ('low','medium','high','critical')),
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  foreign key(agency_id,client_organization_id,project_id,proof_asset_id) references public.business_proof_assets(agency_id,client_organization_id,project_id,id) on delete restrict
);

create table public.serp_intent_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  query text not null, normalized_query text not null, location text, device text not null default 'desktop',
  dominant_intent text not null, result_mix jsonb not null default '{}', features text[] not null default '{}', competitor_urls jsonb not null default '[]',
  evidence_source text not null, captured_at timestamptz not null default now(), created_at timestamptz not null default now(),
  foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.seo_creative_specs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  opportunity_id uuid, owner_page_url text, target_keyword text not null, query_cluster jsonb not null default '[]',
  search_intent text not null, funnel_stage text not null default 'consideration', creative_angle text not null, user_job text not null,
  evidence_requirements jsonb not null default '[]', proof_asset_ids uuid[] not null default '{}', claim_ids uuid[] not null default '{}',
  required_sections jsonb not null default '[]', visual_requirements jsonb not null default '[]', internal_link_plan jsonb not null default '[]',
  conversion_goal jsonb not null default '{}', schema_plan jsonb not null default '[]', restrictions jsonb not null default '[]',
  originality_threshold numeric(5,2) not null default 70 check(originality_threshold between 0 and 100),
  status text not null default 'draft' check(status in ('draft','evidence_needed','ready','generating','generated','approved','implemented','rejected')),
  quality_score numeric(5,2), expected_value jsonb not null default '{}', created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  foreign key(agency_id,client_organization_id,project_id,opportunity_id) references public.seo_opportunities(agency_id,client_organization_id,project_id,id) on delete restrict
);

create table public.seo_creative_drafts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null, creative_spec_id uuid not null,
  version int not null default 1 check(version > 0), model_provider text not null, model_name text not null, model_response_id text,
  title text not null, meta_description text not null, h1 text not null, summary text not null,
  sections jsonb not null default '[]', faqs jsonb not null default '[]', internal_links jsonb not null default '[]', schema_markup jsonb not null default '{}', cta jsonb not null default '{}',
  claims_used jsonb not null default '[]', proof_used jsonb not null default '[]',
  originality_score numeric(5,2) not null default 0, evidence_coverage_score numeric(5,2) not null default 0,
  helpfulness_score numeric(5,2) not null default 0, conversion_score numeric(5,2) not null default 0, qa_results jsonb not null default '{}',
  status text not null default 'generated' check(status in ('generated','qa_failed','awaiting_review','approved','rejected','implemented')),
  requested_by uuid references auth.users(id) on delete set null, approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(creative_spec_id,version),
  foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
  foreign key(agency_id,client_organization_id,project_id,creative_spec_id) references public.seo_creative_specs(agency_id,client_organization_id,project_id,id) on delete cascade
);

create table public.seo_leads (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null, client_organization_id uuid not null, project_id uuid not null,
  source text not null, landing_page_url text, query text, lead_type text not null default 'form', external_id text,
  status text not null default 'new', qualified boolean, revenue numeric(12,2), gross_profit numeric(12,2),
  occurred_at timestamptz not null default now(), metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create unique index seo_leads_external_identity on public.seo_leads(project_id,source,external_id) where external_id is not null;

create table public.seo_experiment_observations (
  id uuid primary key default gen_random_uuid(), experiment_id uuid not null references public.seo_experiments(id) on delete cascade,
  observation_day int not null check(observation_day >= 0), observed_at timestamptz not null default now(),
  metrics jsonb not null default '{}', baseline_metrics jsonb not null default '{}', comparison_metrics jsonb not null default '{}',
  interpretation text, confidence numeric(5,4) not null default 0 check(confidence between 0 and 1), created_by_agent text,
  unique(experiment_id,observation_day)
);

create index business_proof_project_status on public.business_proof_assets(project_id,verification_status,created_at desc);
create index business_claims_project_status on public.business_claims(project_id,status,created_at desc);
create index serp_intent_project_query on public.serp_intent_snapshots(project_id,normalized_query,captured_at desc);
create index creative_specs_project_status on public.seo_creative_specs(project_id,status,created_at desc);
create index creative_drafts_project_status on public.seo_creative_drafts(project_id,status,created_at desc);
create index seo_leads_project_time on public.seo_leads(project_id,occurred_at desc);

do $$ declare t text; begin
  foreach t in array array['business_proof_assets','business_claims','serp_intent_snapshots','seo_creative_specs','seo_creative_drafts','seo_leads'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I_tenant_read on public.%I for select to authenticated using(public.has_client_access(agency_id,client_organization_id))',t,t);
  end loop;
end $$;
alter table public.seo_experiment_observations enable row level security;
create policy seo_experiment_observations_tenant_read on public.seo_experiment_observations for select to authenticated using(exists(select 1 from public.seo_experiments e where e.id=experiment_id and public.has_client_access(e.agency_id,e.client_organization_id)));

-- Proof media is private. Server-side service-role routes issue access only after tenant authorization.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('business-proof','business-proof',false,10485760,array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/wav','application/pdf'])
    on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
  end if;
end $$;

insert into public.agent_tools(tool_key,name,description,provider,operation_type,default_risk_level,paid,destructive,secret_scope) values
('proof.read','Read verified business proof','Read tenant-scoped, human-verified facts and media references.','hdseo','read','low',false,false,'project'),
('creative.spec','Compile creative specification','Combine intent, page ownership, proof, conversion goals, and restrictions.','hdseo','draft','low',false,false,'project'),
('creative.generate','Generate evidence-gated creative','Generate structured copy using only verified proof and approved claims.','openai','draft','medium',true,false,'project')
on conflict(tool_key) do update set name=excluded.name,description=excluded.description,provider=excluded.provider,operation_type=excluded.operation_type,default_risk_level=excluded.default_risk_level,paid=excluded.paid,destructive=excluded.destructive,secret_scope=excluded.secret_scope,updated_at=now();

insert into public.agent_tool_grants(agent_definition_id,tool_key,permission,approval_required,constraints)
select d.id,g.tool_key,'use',false,g.constraints from public.agent_definitions d join(values
('content','proof.read','{}'::jsonb),('content','creative.spec','{}'),('content','creative.generate','{"verifiedProofMinimum":2,"humanApprovalBeforePublish":true}'),
('strategy','proof.read','{}'),('qa','proof.read','{}'),('qa','creative.spec','{}'),('reporting','proof.read','{}')
)as g(agent_key,tool_key,constraints)on d.agent_key=g.agent_key and d.agency_id is null
on conflict(agent_definition_id,tool_key)do update set permission=excluded.permission,approval_required=excluded.approval_required,constraints=excluded.constraints;
