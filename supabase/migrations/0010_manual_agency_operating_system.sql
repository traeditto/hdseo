alter type public.seo_action_type add value if not exists 'CONVERSION';
alter type public.seo_action_type add value if not exists 'CTR_WIN';
alter type public.seo_action_type add value if not exists 'QUERY_EXPANSION';
alter type public.seo_action_type add value if not exists 'WRONG_PAGE';
alter type public.seo_action_type add value if not exists 'EVIDENCE_REQUEST';

create table public.websites(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,
 name text not null,site_url text not null,canonical_domain text not null,cms_type text not null default 'unknown',is_primary boolean not null default true,
 status text not null default 'active',last_verified_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(project_id,canonical_domain),unique(agency_id,client_organization_id,project_id,id),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.cms_connections(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,website_id uuid,
 cms_type text not null,editor_mode text,site_url text not null,connection_mode text not null default 'manual',status text not null default 'manual',
 encrypted_secret_reference text,last_verified_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(project_id,site_url),foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade,
 foreign key(website_id) references public.websites(id) on delete set null
);
create table public.business_evidence(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,
 evidence_type text not null,title text not null,value text,approved_wording text,source text not null,source_url text,source_file text,
 approval_status text not null default 'pending',approved_by uuid references auth.users(id),approved_at timestamptz,expires_at timestamptz,
 publication_scope text not null default 'internal',metadata jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(agency_id,client_organization_id,project_id,id),foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.evidence_requests(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,opportunity_id uuid,
 evidence_type text not null,title text not null,instructions text,status text not null default 'requested',requested_by uuid not null references auth.users(id),
 assigned_to uuid references auth.users(id),client_visible boolean not null default true,due_at timestamptz,resolved_evidence_id uuid references public.business_evidence(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.opportunity_dependencies(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,
 opportunity_id uuid not null references public.seo_opportunities(id) on delete cascade,related_opportunity_id uuid references public.seo_opportunities(id) on delete cascade,
 dependency_type text not null check(dependency_type in ('blocked_by','enables','conflicts_with','must_precede','requires_evidence','requires_data_refresh','requires_repository_connection','requires_client_approval')),
 status text not null default 'open',details jsonb not null default '{}',created_at timestamptz not null default now(),unique(opportunity_id,related_opportunity_id,dependency_type),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.risk_budgets(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,project_id uuid,
 max_pages_changed_month int not null default 10,max_new_pages_month int not null default 2,max_concurrent_implementations int not null default 1,
 max_high_risk_actions int not null default 0,max_affected_urls int not null default 10,max_canonical_changes int not null default 0,
 max_redirect_changes int not null default 5,minimum_confidence_for_draft int not null default 65,required_approval_by_risk jsonb not null default '{"low":"seo_strategist","medium":"seo_director","high":"agency_owner"}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(agency_id,project_id),foreign key(agency_id) references public.agencies(id) on delete cascade
);
create table public.agency_playbooks(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null references public.agencies(id) on delete cascade,name text not null,action_type public.seo_action_type,
 required_evidence jsonb not null default '[]',required_checks jsonb not null default '[]',task_sequence jsonb not null default '[]',risk_level text not null default 'medium',
 approval_rules jsonb not null default '{}',completion_criteria jsonb not null default '[]',monitoring_days int[] not null default array[7,14,30,60,90],status text not null default 'active',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(agency_id,name)
);
create table public.implementation_packages(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,
 opportunity_id uuid not null references public.seo_opportunities(id) on delete restrict,action_draft_id uuid references public.seo_action_drafts(id) on delete set null,
 website_id uuid references public.websites(id) on delete set null,implementation_path text not null check(implementation_path in ('wordpress_package','generic_cms','developer_ticket')),
 cms_mode text,version int not null default 1,status text not null default 'draft',risk_level text not null default 'medium',estimated_effort text,
 hypothesis text,current_state jsonb not null default '{}',proposed_state jsonb not null default '{}',package_data jsonb not null default '{}',
 required_evidence jsonb not null default '[]',dependencies jsonb not null default '[]',acceptance_criteria jsonb not null default '[]',verification_checklist jsonb not null default '[]',
 created_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),approved_at timestamptz,implemented_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(opportunity_id,version),unique(agency_id,client_organization_id,project_id,id),foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.seo_task_approvals(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,task_id uuid not null references public.seo_tasks(id) on delete cascade,
 approval_type text not null check(approval_type in ('agency','client','technical','risk')),status text not null default 'awaiting',requested_by uuid not null references auth.users(id),
 decided_by uuid references auth.users(id),decision_note text,requested_at timestamptz not null default now(),decided_at timestamptz,unique(task_id,approval_type),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.seo_task_evidence(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,task_id uuid not null references public.seo_tasks(id) on delete cascade,
 evidence_type text not null,title text not null,value text,source_url text,file_reference text,client_visible boolean not null default false,verified_at timestamptz,verified_by uuid references auth.users(id),
 created_at timestamptz not null default now(),foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.implementation_verifications(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,package_id uuid not null references public.implementation_packages(id) on delete cascade,
 task_id uuid references public.seo_tasks(id) on delete set null,live_url text not null,status text not null default 'pending',checks jsonb not null default '{}',proof jsonb not null default '{}',
 verified_by uuid references auth.users(id),verified_at timestamptz,error_details jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(package_id),foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.proof_of_work_events(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,
 opportunity_id uuid,package_id uuid references public.implementation_packages(id) on delete set null,task_id uuid references public.seo_tasks(id) on delete set null,
 event_type text not null,title text not null,description text,client_visible boolean not null default false,actor_user_id uuid references auth.users(id),metadata jsonb not null default '{}',occurred_at timestamptz not null default now(),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.seo_experiments(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,opportunity_id uuid,package_id uuid references public.implementation_packages(id),execution_id uuid references public.seo_executions(id),
 hypothesis text not null,primary_metric text not null,secondary_metrics jsonb not null default '[]',target_group jsonb not null default '{}',comparison_group jsonb not null default '{}',confounders jsonb not null default '[]',
 evaluation_window int[] not null default array[7,14,30,60,90],status text not null default 'planned',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.integration_connections(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid,project_id uuid,provider text not null,connection_type text not null,status text not null default 'pending',
 external_account_id text,selected_resource text,encrypted_secret_reference text,scopes text[] not null default '{}',last_synced_at timestamptz,last_verified_at timestamptz,metadata jsonb not null default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(project_id,provider),foreign key(agency_id) references public.agencies(id) on delete cascade
);
create table public.search_console_rows(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,query text,page_url text,date date not null,device text,country text,
 clicks numeric not null default 0,impressions numeric not null default 0,ctr numeric,average_position numeric,source_connection_id uuid references public.integration_connections(id),captured_at timestamptz not null default now(),
 unique(project_id,date,query,page_url,device,country),foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.url_inspection_snapshots(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,url text not null,index_status text,google_canonical text,user_canonical text,
 indexing_allowed boolean,crawl_state text,last_crawl_at timestamptz,referring_sitemaps jsonb not null default '[]',raw_response jsonb not null default '{}',captured_at timestamptz not null default now(),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);
create table public.notifications(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid,project_id uuid,user_id uuid references auth.users(id),event_type text not null,title text not null,body text,
 channel text not null default 'in_app',status text not null default 'queued',client_visible boolean not null default false,read_at timestamptz,sent_at timestamptz,metadata jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(agency_id) references public.agencies(id) on delete cascade
);
create table public.reports(
 id uuid primary key default gen_random_uuid(),agency_id uuid not null,client_organization_id uuid not null,project_id uuid not null,title text not null,period_start date,period_end date,status text not null default 'draft',
 branding_snapshot jsonb not null default '{}',content jsonb not null default '{}',client_visible boolean not null default false,generated_by uuid references auth.users(id),published_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(agency_id,client_organization_id,project_id) references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

do $$ declare t text; begin foreach t in array array['websites','cms_connections','business_evidence','evidence_requests','opportunity_dependencies','risk_budgets','agency_playbooks','implementation_packages','seo_task_approvals','seo_task_evidence','implementation_verifications','proof_of_work_events','seo_experiments','integration_connections','search_console_rows','url_inspection_snapshots','notifications','reports'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['websites','cms_connections','business_evidence','evidence_requests','opportunity_dependencies','implementation_packages','seo_task_approvals','seo_task_evidence','implementation_verifications','proof_of_work_events','seo_experiments','search_console_rows','url_inspection_snapshots','reports'] loop execute format('create policy %I_agency_read on public.%I for select to authenticated using(public.is_agency_member(agency_id))',t,t); end loop; end $$;
create policy risk_budgets_agency on public.risk_budgets for all to authenticated using(public.is_agency_member(agency_id)) with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy playbooks_agency on public.agency_playbooks for all to authenticated using(public.is_agency_member(agency_id)) with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy integration_agency on public.integration_connections for all to authenticated using(public.is_agency_member(agency_id)) with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy notifications_self on public.notifications for select to authenticated using(user_id=auth.uid() or public.is_agency_member(agency_id));
create index implementation_packages_project_status on public.implementation_packages(project_id,status,created_at desc);
create index proof_timeline_project on public.proof_of_work_events(project_id,occurred_at desc);
create index gsc_project_date on public.search_console_rows(project_id,date desc);
