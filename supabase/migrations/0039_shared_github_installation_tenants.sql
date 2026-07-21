begin;

-- A GitHub App can be installed only once per GitHub account. The verified
-- installation grant may therefore serve more than one HD SEO tenant owned by
-- the same GitHub administrator, while repository bindings remain tenant scoped.
alter table public.repositories
  drop constraint if exists repositories_github_installation_id_github_repository_id_key;

create unique index if not exists repositories_agency_installation_repository_uidx
  on public.repositories(agency_id,github_installation_id,github_repository_id);

comment on index public.repositories_agency_installation_repository_uidx is
  'Allows a verified GitHub App installation to be reused while preventing duplicate repository bindings inside one agency tenant.';

commit;
