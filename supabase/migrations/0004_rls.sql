create or replace function public.is_agency_member(target_agency uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.agency_members m where m.agency_id = target_agency and m.user_id = auth.uid() and m.status = 'active')
$$;

create or replace function public.has_agency_role(target_agency uuid, allowed public.agency_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.agency_members m where m.agency_id = target_agency and m.user_id = auth.uid() and m.status = 'active' and m.role = any(allowed))
$$;

create or replace function public.has_client_access(target_agency uuid, target_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_agency_member(target_agency) or exists(select 1 from public.client_members cm where cm.agency_id = target_agency and cm.client_organization_id = target_client and cm.user_id = auth.uid() and cm.status = 'active')
$$;

grant execute on function public.is_agency_member(uuid) to authenticated;
grant execute on function public.has_agency_role(uuid, public.agency_role[]) to authenticated;
grant execute on function public.has_client_access(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.agencies enable row level security;
alter table public.agency_members enable row level security;
alter table public.client_organizations enable row level security;
alter table public.client_members enable row level security;
alter table public.agency_branding enable row level security;
alter table public.agency_domains enable row level security;
alter table public.seo_projects enable row level security;
alter table public.seo_services enable row level security;
alter table public.seo_locations enable row level security;
alter table public.seo_keywords enable row level security;
alter table public.keyword_metrics enable row level security;
alter table public.organic_ranking_snapshots enable row level security;
alter table public.seo_opportunities enable row level security;
alter table public.seo_action_drafts enable row level security;
alter table public.seo_tasks enable row level security;
alter table public.data_provider_connections enable row level security;
alter table public.data_usage_events enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self on public.profiles for select using (id = auth.uid());
create policy agencies_member_read on public.agencies for select using (public.is_agency_member(id));
create policy members_member_read on public.agency_members for select using (public.is_agency_member(agency_id));
create policy clients_access_read on public.client_organizations for select using (public.has_client_access(agency_id, id));
create policy client_members_access_read on public.client_members for select using (public.has_client_access(agency_id, client_organization_id));
create policy branding_member_read on public.agency_branding for select using (public.is_agency_member(agency_id));
create policy domains_member_read on public.agency_domains for select using (public.is_agency_member(agency_id));
create policy projects_access_read on public.seo_projects for select using (public.has_client_access(agency_id, client_organization_id));
create policy services_access_read on public.seo_services for select using (public.has_client_access(agency_id, client_organization_id));
create policy locations_access_read on public.seo_locations for select using (public.has_client_access(agency_id, client_organization_id));
create policy keywords_access_read on public.seo_keywords for select using (public.has_client_access(agency_id, client_organization_id));
create policy metrics_access_read on public.keyword_metrics for select using (public.has_client_access(agency_id, client_organization_id));
create policy rankings_access_read on public.organic_ranking_snapshots for select using (public.has_client_access(agency_id, client_organization_id));
create policy opportunities_access_read on public.seo_opportunities for select using (public.has_client_access(agency_id, client_organization_id));
create policy drafts_access_read on public.seo_action_drafts for select using (public.has_client_access(agency_id, client_organization_id));
create policy tasks_access_read on public.seo_tasks for select using (public.has_client_access(agency_id, client_organization_id));
create policy connections_privileged_all on public.data_provider_connections for all using (public.has_agency_role(agency_id, array['agency_owner','agency_admin','seo_director']::public.agency_role[])) with check (public.has_agency_role(agency_id, array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy usage_privileged_read on public.data_usage_events for select using (public.has_agency_role(agency_id, array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy audit_member_read on public.audit_logs for select using (public.has_agency_role(agency_id, array['agency_owner','agency_admin']::public.agency_role[]));

create policy seo_write on public.seo_opportunities for all using (public.has_agency_role(agency_id, array['agency_owner','agency_admin','seo_director','seo_strategist']::public.agency_role[])) with check (public.has_agency_role(agency_id, array['agency_owner','agency_admin','seo_director','seo_strategist']::public.agency_role[]));
create policy tasks_write on public.seo_tasks for all using (public.has_agency_role(agency_id, array['agency_owner','agency_admin','seo_director','seo_strategist','account_manager']::public.agency_role[])) with check (public.has_agency_role(agency_id, array['agency_owner','agency_admin','seo_director','seo_strategist','account_manager']::public.agency_role[]));
