-- Complete the tenant binding required by the deployment queue.
-- Migration 0046 reconciled deployments independently, so installations that
-- received 0046 without the larger 0036 security migration can still be
-- missing this column on seo_jobs.

begin;

alter table public.seo_jobs
  add column if not exists client_organization_id uuid;

update public.seo_jobs j
set client_organization_id = c.organization_id
from public.clients c
where c.id = j.client_id
  and c.agency_id = j.agency_id
  and j.client_organization_id is null;

do $$
begin
  if exists (
    select 1
    from public.seo_jobs
    where client_organization_id is null
  ) then
    raise exception 'SEO_JOB_TENANT_BACKFILL_INCOMPLETE';
  end if;
end $$;

alter table public.seo_jobs
  alter column client_organization_id set not null;

create index if not exists seo_jobs_tenant_queue_idx
  on public.seo_jobs(
    agency_id,
    client_organization_id,
    project_id,
    status,
    created_at desc
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.seo_jobs'::regclass
      and conname = 'seo_jobs_client_organization_fk'
  ) then
    alter table public.seo_jobs
      add constraint seo_jobs_client_organization_fk
      foreign key(client_organization_id)
      references public.client_organizations(id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.seo_jobs'::regclass
      and conname = 'seo_jobs_project_tenant_0048_fk'
  ) then
    alter table public.seo_jobs
      add constraint seo_jobs_project_tenant_0048_fk
      foreign key(agency_id,client_organization_id,project_id)
      references public.seo_projects(agency_id,client_organization_id,id)
      on delete cascade
      not valid;
  end if;
end $$;

alter table public.seo_jobs
  validate constraint seo_jobs_client_organization_fk;

alter table public.seo_jobs
  validate constraint seo_jobs_project_tenant_0048_fk;

commit;
