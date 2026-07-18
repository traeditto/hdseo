-- Make geographic targeting an explicit project-level control.
-- Existing projects remain service-area scoped until an owner or agency
-- intentionally changes them to nationwide.

alter table public.seo_projects
  add column if not exists market_scope text not null default 'service_area';

alter table public.seo_projects
  drop constraint if exists seo_projects_market_scope_check;

alter table public.seo_projects
  add constraint seo_projects_market_scope_check
  check (market_scope in ('service_area','nationwide'));

comment on column public.seo_projects.market_scope is
  'Controls geographic keyword filtering. service_area enforces seo_locations; nationwide accepts demand throughout the project country.';

