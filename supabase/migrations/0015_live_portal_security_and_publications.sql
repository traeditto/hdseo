-- Bring the live portal onto the same explicit publication boundary used by
-- the durable approval APIs. Existing client-visible packages are backfilled
-- so deploying this migration does not hide work already sent to clients.

insert into public.client_portal_publications (
  agency_id,
  client_organization_id,
  project_id,
  record_type,
  source_id,
  title,
  summary,
  status,
  payload,
  published_by,
  published_at
)
select
  package.agency_id,
  package.client_organization_id,
  package.project_id,
  'implementation_package',
  package.id,
  coalesce(package.package_data ->> 'title', 'SEO implementation approval'),
  'Review the proposed SEO implementation, its evidence, and acceptance checks.',
  case
    when package.status in ('client_review', 'awaiting_client') then 'awaiting_client'
    else package.status
  end,
  jsonb_build_object(
    'implementationPath', package.implementation_path,
    'metadata', coalesce(package.package_data -> 'metadata', '{}'::jsonb),
    'acceptanceCriteria', coalesce(package.package_data -> 'acceptanceCriteria', '[]'::jsonb),
    'verificationChecklist', coalesce(package.package_data -> 'verificationChecklist', '[]'::jsonb)
  ),
  package.created_by,
  package.updated_at
from public.implementation_packages package
where package.status in (
  'client_review',
  'awaiting_client',
  'client_approved',
  'revision_requested',
  'rejected',
  'implemented',
  'implemented_unverified',
  'verified'
)
on conflict (project_id, record_type, source_id) do update
set
  title = excluded.title,
  summary = excluded.summary,
  status = excluded.status,
  payload = excluded.payload,
  revoked_at = null;

create index if not exists client_portal_publications_client_status_idx
  on public.client_portal_publications (
    client_organization_id,
    status,
    published_at desc
  )
  where revoked_at is null;

create index if not exists implementation_packages_client_status_idx
  on public.implementation_packages (
    client_organization_id,
    status,
    updated_at desc
  );
