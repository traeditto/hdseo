-- Zero-input discovery and baseline-aware deployment drift validation.

alter table public.deployment_checks
  drop constraint if exists deployment_checks_check_type_check;

alter table public.deployment_checks
  add constraint deployment_checks_check_type_check
  check (check_type in ('health','lighthouse','seo','schema','sitemap','robots','indexing_readiness','drift'));

create index if not exists search_console_project_query_date_idx
  on public.search_console_rows(project_id,query,date desc)
  where query is not null;

create index if not exists seo_keywords_project_normalized_idx
  on public.seo_keywords(project_id,normalized_keyword)
  where status='active';

comment on column public.seo_campaign_jobs.current_stage is
  'Restartable stage. New campaigns begin with discover and derive keywords from first-party or explicitly authorized domain evidence.';
