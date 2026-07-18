-- Retail client experience for owner-operated businesses.
-- Retail workspaces remain normal HD SEO tenants, but owners receive a
-- dedicated growth profile, subscription lifecycle, and support trail.

alter table public.webhook_events drop constraint if exists webhook_events_provider_check;
alter table public.webhook_events add constraint webhook_events_provider_check
  check(provider in ('github','vercel','stripe'));

create table public.client_growth_profiles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  onboarding_status text not null default 'business_profile'
    check (onboarding_status in ('business_profile','connections','ready','active','paused')),
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 7),
  business_goal text not null default 'more_qualified_leads'
    check (business_goal in ('more_qualified_leads','more_calls','more_bookings','more_store_visits','more_sales','build_visibility')),
  services text[] not null default '{}',
  service_areas text[] not null default '{}',
  priority_services text[] not null default '{}',
  ideal_customer text,
  average_customer_value numeric(14,2),
  monthly_budget numeric(14,2) not null default 99 check (monthly_budget >= 0),
  automation_level text not null default 'safe'
    check (automation_level in ('recommend','safe','concierge')),
  notification_preferences jsonb not null default '{"weeklySummary":true,"approvalNeeded":true,"results":true}',
  last_owner_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id),
  unique(agency_id,client_organization_id,project_id,id),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  plan_key text not null default 'free_audit'
    check (plan_key in ('free_audit','starter','growth','pro')),
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','paused','canceled')),
  billing_interval text not null default 'month'
    check (billing_interval in ('month','year')),
  price_cents integer not null default 0 check (price_cents >= 0),
  currency char(3) not null default 'USD',
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_ends_at timestamptz default (now() + interval '14 days'),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id),
  unique(stripe_subscription_id),
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create table public.client_support_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  category text not null default 'question'
    check (category in ('question','approval_help','connection_help','billing','result_question')),
  subject text not null,
  message text not null,
  status text not null default 'open'
    check (status in ('open','in_progress','waiting_on_client','resolved','closed')),
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key(agency_id,client_organization_id,project_id)
    references public.seo_projects(agency_id,client_organization_id,id) on delete cascade
);

create index client_growth_profiles_owner_idx
  on public.client_growth_profiles(owner_user_id,updated_at desc);
create index client_subscriptions_status_idx
  on public.client_subscriptions(status,current_period_end);
create index client_support_requests_open_idx
  on public.client_support_requests(client_organization_id,status,created_at desc);

alter table public.client_growth_profiles enable row level security;
alter table public.client_subscriptions enable row level security;
alter table public.client_support_requests enable row level security;

create policy client_growth_profiles_read on public.client_growth_profiles
  for select to authenticated
  using(public.has_client_access(agency_id,client_organization_id) or public.is_agency_member(agency_id));
create policy client_growth_profiles_owner_update on public.client_growth_profiles
  for update to authenticated
  using(public.has_client_access(agency_id,client_organization_id))
  with check(public.has_client_access(agency_id,client_organization_id));
create policy client_growth_profiles_agency_all on public.client_growth_profiles
  for all to authenticated
  using(public.is_agency_member(agency_id))
  with check(public.is_agency_member(agency_id));

create policy client_subscriptions_read on public.client_subscriptions
  for select to authenticated
  using(public.has_client_access(agency_id,client_organization_id) or public.is_agency_member(agency_id));
create policy client_subscriptions_agency_all on public.client_subscriptions
  for all to authenticated
  using(public.is_agency_member(agency_id))
  with check(public.is_agency_member(agency_id));

create policy client_support_requests_read on public.client_support_requests
  for select to authenticated
  using(public.has_client_access(agency_id,client_organization_id) or public.is_agency_member(agency_id));
create policy client_support_requests_insert on public.client_support_requests
  for insert to authenticated
  with check(public.has_client_access(agency_id,client_organization_id) and requested_by=auth.uid());
create policy client_support_requests_agency_update on public.client_support_requests
  for update to authenticated
  using(public.is_agency_member(agency_id))
  with check(public.is_agency_member(agency_id));

-- Atomic tenant creation for a direct retail customer. It is callable only by
-- the service role; browser users cannot create or attach arbitrary tenants.
create or replace function public.create_retail_workspace(
  p_user_id uuid,
  p_email text,
  p_business_name text,
  p_domain text,
  p_site_url text,
  p_phone text,
  p_services text[],
  p_service_areas text[],
  p_priority_services text[],
  p_ideal_customer text,
  p_customer_value numeric,
  p_monthly_budget numeric,
  p_automation_level text,
  p_platform text,
  p_website_reachable boolean
) returns table(agency_id uuid,client_id uuid,project_id uuid,website_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_website uuid := gen_random_uuid();
  v_slug text;
  v_service text;
  v_area text;
  v_index integer := 0;
begin
  if exists(select 1 from public.client_members where user_id=p_user_id and status='active') then
    raise exception 'RETAIL_MEMBERSHIP_EXISTS';
  end if;
  if p_automation_level not in ('recommend','safe','concierge') then
    raise exception 'INVALID_AUTOMATION_LEVEL';
  end if;
  v_slug := regexp_replace(lower(trim(p_business_name)),'[^a-z0-9]+','-','g');
  v_slug := trim(both '-' from v_slug) || '-owner-' || substr(replace(gen_random_uuid()::text,'-',''),1,8);

  insert into public.agencies(id,name,slug,status,plan,billing_email)
  values(v_agency,p_business_name || ' Owner Workspace',v_slug,'trial','retail',lower(p_email));
  insert into public.client_organizations(
    id,agency_id,name,slug,status,primary_contact_email,primary_contact_name
  ) values(v_client,v_agency,p_business_name,'business','onboarding',lower(p_email),p_business_name);
  insert into public.client_members(
    agency_id,client_organization_id,user_id,role,status
  ) values(v_agency,v_client,p_user_id,'client_admin','active');
  insert into public.seo_projects(
    id,agency_id,client_organization_id,name,domain,canonical_domain,industry,primary_market,status,data_readiness_status
  ) values(
    v_project,v_agency,v_client,'Local Growth',p_domain,p_domain,p_services[1],p_service_areas[1],'active','collecting'
  );
  insert into public.websites(
    id,agency_id,client_organization_id,project_id,name,site_url,canonical_domain,cms_type,is_primary,status,last_verified_at
  ) values(
    v_website,v_agency,v_client,v_project,p_business_name,p_site_url,p_domain,coalesce(p_platform,'unknown'),true,
    case when p_website_reachable then 'active' else 'connection_required' end,
    case when p_website_reachable then now() else null end
  );

  -- The enterprise mirror may already exist because of its synchronization trigger.
  insert into public.clients(id,agency_id,organization_id,name,status,automation_config)
  values(v_client,v_agency,v_client,p_business_name,'onboarding',jsonb_build_object(
    'automationLevel',p_automation_level,
    'approvalRequired',true,
    'safeChangesAutomatic',p_automation_level <> 'recommend',
    'highRiskApprovalRequired',true,
    'autoRollback',true,
    'onboardingStatus','connections'
  )) on conflict(organization_id) do update set
    automation_config=excluded.automation_config,
    status='onboarding',
    updated_at=now();

  insert into public.client_growth_profiles(
    agency_id,client_organization_id,project_id,owner_user_id,onboarding_status,onboarding_step,
    services,service_areas,priority_services,ideal_customer,average_customer_value,monthly_budget,
    automation_level,notification_preferences
  ) values(
    v_agency,v_client,v_project,p_user_id,'connections',5,coalesce(p_services,'{}'),coalesce(p_service_areas,'{}'),
    coalesce(p_priority_services,'{}'),nullif(p_ideal_customer,''),p_customer_value,p_monthly_budget,p_automation_level,
    '{"weeklySummary":true,"approvalNeeded":true,"results":true}'::jsonb
  );
  insert into public.client_subscriptions(
    agency_id,client_organization_id,project_id,plan_key,status,price_cents
  ) values(v_agency,v_client,v_project,'free_audit','trialing',0);

  foreach v_service in array coalesce(p_services,'{}') loop
    v_index := v_index + 1;
    insert into public.seo_services(agency_id,client_organization_id,project_id,name,slug,category,priority,status)
    values(v_agency,v_client,v_project,v_service,
      regexp_replace(lower(trim(v_service)),'[^a-z0-9]+','-','g') || '-' || v_index,
      'core_service',greatest(50,100-v_index*5),'active');
  end loop;
  v_index := 0;
  foreach v_area in array coalesce(p_service_areas,'{}') loop
    v_index := v_index + 1;
    insert into public.seo_locations(agency_id,client_organization_id,project_id,name,city,country_code,priority,status)
    values(v_agency,v_client,v_project,v_area,v_area,'US',greatest(50,100-v_index*3),'active');
  end loop;
  insert into public.proof_of_work_events(
    agency_id,client_organization_id,project_id,event_type,title,description,client_visible,actor_user_id
  ) values(
    v_agency,v_client,v_project,'retail_onboarding_started','HD SEO started learning your business',
    'Your website, services, service area, goals, and safety preferences were saved. No keywords were required.',true,p_user_id
  );
  return query select v_agency,v_client,v_project,v_website;
end $$;

revoke all on function public.create_retail_workspace(
  uuid,text,text,text,text,text,text[],text[],text[],text,numeric,numeric,text,text,boolean
) from public,anon,authenticated;
grant execute on function public.create_retail_workspace(
  uuid,text,text,text,text,text,text[],text[],text[],text,numeric,numeric,text,text,boolean
) to service_role;
