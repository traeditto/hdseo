alter table public.seo_monitoring_plans alter column execution_id drop not null;
alter table public.seo_monitoring_plans add column if not exists implementation_package_id uuid unique references public.implementation_packages(id) on delete cascade;
alter table public.seo_monitoring_plans add column if not exists implementation_path text;
alter table public.seo_monitoring_plans add column if not exists verification_date date;
alter table public.seo_monitoring_plans add constraint monitoring_source_required check(execution_id is not null or implementation_package_id is not null);

create or replace function public.create_manual_monitoring_plan(p_package_id uuid,p_verified_by uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare package_row public.implementation_packages; opportunity_row public.seo_opportunities; keyword_row public.seo_keywords; verification_row public.implementation_verifications; plan_id uuid; baseline int; baseline_url text;
begin
  select * into package_row from public.implementation_packages where id=p_package_id for update;
  if package_row.id is null then raise exception 'package not found'; end if;
  select * into verification_row from public.implementation_verifications where package_id=p_package_id and status='passed' and verified_by=p_verified_by;
  if verification_row.id is null then raise exception 'passed verification not found'; end if;
  select * into opportunity_row from public.seo_opportunities where id=package_row.opportunity_id;
  select * into keyword_row from public.seo_keywords where project_id=package_row.project_id and normalized_keyword=lower(trim(coalesce(opportunity_row.evidence->>'keyword',''))) limit 1;
  if keyword_row.id is not null then select position::int,ranking_url into baseline,baseline_url from public.organic_ranking_snapshots where keyword_id=keyword_row.id order by collected_at desc limit 1; end if;
  insert into public.seo_monitoring_plans(agency_id,client_organization_id,project_id,implementation_package_id,opportunity_id,keyword_id,target_url,baseline_position,baseline_ranking_url,target_milestone,implementation_date,verification_date,implementation_path)
  values(package_row.agency_id,package_row.client_organization_id,package_row.project_id,package_row.id,package_row.opportunity_id,keyword_row.id,verification_row.live_url,baseline,baseline_url,opportunity_row.target_milestone,current_date,current_date,package_row.implementation_path)
  on conflict(implementation_package_id) do update set verification_date=current_date,updated_at=now() returning id into plan_id;
  insert into public.seo_monitoring_checkpoints(monitoring_plan_id,checkpoint_day,due_at)
  select plan_id,day,now()+make_interval(days=>day) from unnest(array[7,14,30,60,90]) day on conflict(monitoring_plan_id,checkpoint_day) do nothing;
  update public.implementation_packages set status='verified',implemented_at=coalesce(implemented_at,now()),updated_at=now() where id=p_package_id;
  update public.seo_projects set manual_workflow_verified_at=coalesce(manual_workflow_verified_at,now()),updated_at=now() where id=package_row.project_id;
  return plan_id;
end $$;
revoke all on function public.create_manual_monitoring_plan(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_manual_monitoring_plan(uuid,uuid) to service_role;
