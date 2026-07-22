-- Repair deployments created before the enterprise tenant column was present.
-- The reconciliation worker depends on this value to bind rollback baselines
-- without ever crossing agency/client/project boundaries.

begin;

alter table public.deployments
  add column if not exists client_organization_id uuid;

update public.deployments d
set client_organization_id = c.organization_id
from public.clients c
where c.id = d.client_id
  and c.agency_id = d.agency_id
  and d.client_organization_id is null;

do $$
begin
  if exists (
    select 1
    from public.deployments
    where client_organization_id is null
  ) then
    raise exception 'DEPLOYMENT_TENANT_BACKFILL_INCOMPLETE';
  end if;
end $$;

alter table public.deployments
  alter column client_organization_id set not null;

create index if not exists deployments_tenant_reconciliation_idx
  on public.deployments(
    agency_id,
    client_organization_id,
    project_id,
    environment,
    status,
    updated_at desc
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deployments'::regclass
      and conname = 'deployments_client_organization_fk'
  ) then
    alter table public.deployments
      add constraint deployments_client_organization_fk
      foreign key(client_organization_id)
      references public.client_organizations(id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deployments'::regclass
      and conname = 'deployments_project_tenant_0046_fk'
  ) then
    alter table public.deployments
      add constraint deployments_project_tenant_0046_fk
      foreign key(agency_id,client_organization_id,project_id)
      references public.seo_projects(agency_id,client_organization_id,id)
      on delete cascade
      not valid;
  end if;
end $$;

alter table public.deployments
  validate constraint deployments_client_organization_fk;

alter table public.deployments
  validate constraint deployments_project_tenant_0046_fk;

commit;
