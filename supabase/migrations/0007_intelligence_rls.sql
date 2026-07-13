do $$ declare t text; begin foreach t in array array[
  'provider_operation_confirmations','provider_job_locks','keyword_metric_snapshots','competitor_domains','seo_page_snapshots','maps_rank_snapshots','site_audits','audit_findings',
  'seo_campaigns','seo_campaign_jobs','seo_campaign_candidates','repository_connections','seo_executions','seo_execution_files','webhook_deliveries','seo_deployments','seo_monitoring_plans','seo_monitoring_checkpoints'
] loop execute format('alter table public.%I enable row level security', t); end loop; end $$;

do $$ declare t text; begin foreach t in array array[
  'keyword_metric_snapshots','competitor_domains','seo_page_snapshots','maps_rank_snapshots','site_audits','audit_findings','seo_campaigns','seo_campaign_jobs','repository_connections','seo_executions','seo_monitoring_plans'
] loop
  execute format('create policy %I_tenant_read on public.%I for select to authenticated using(public.has_client_access(agency_id,client_organization_id))', t, t);
end loop; end $$;

create policy provider_confirmations_manager on public.provider_operation_confirmations for all to authenticated
using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy provider_locks_read on public.provider_job_locks for select to authenticated using(public.is_agency_member(agency_id));
create policy campaigns_manager_write on public.seo_campaigns for all to authenticated
using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy jobs_manager_write on public.seo_campaign_jobs for all to authenticated
using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]))
with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director']::public.agency_role[]));
create policy repositories_manager_write on public.repository_connections for all to authenticated
using(public.has_agency_role(agency_id,array['agency_owner','agency_admin']::public.agency_role[]))
with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin']::public.agency_role[]));
create policy executions_strategist_write on public.seo_executions for all to authenticated
using(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','seo_strategist','developer']::public.agency_role[]))
with check(public.has_agency_role(agency_id,array['agency_owner','agency_admin','seo_director','seo_strategist','developer']::public.agency_role[]));
create policy candidates_read on public.seo_campaign_candidates for select to authenticated using(exists(select 1 from public.seo_campaign_jobs j where j.id=job_id and public.is_agency_member(j.agency_id)));
create policy execution_files_read on public.seo_execution_files for select to authenticated using(exists(select 1 from public.seo_executions e where e.id=execution_id and public.is_agency_member(e.agency_id)));
create policy deployments_read on public.seo_deployments for select to authenticated using(exists(select 1 from public.seo_executions e where e.id=execution_id and public.is_agency_member(e.agency_id)));
create policy checkpoints_read on public.seo_monitoring_checkpoints for select to authenticated using(exists(select 1 from public.seo_monitoring_plans p where p.id=monitoring_plan_id and public.is_agency_member(p.agency_id)));

revoke all on public.provider_job_locks, public.webhook_deliveries from anon, authenticated;
