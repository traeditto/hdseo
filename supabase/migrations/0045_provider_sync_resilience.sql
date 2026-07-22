-- Durable provider retry state prevents broken connections from being retried on every cron
-- while ensuring failures remain visible and recover automatically.
alter table public.integration_connections
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists next_sync_at timestamptz,
  add column if not exists consecutive_sync_failures integer not null default 0,
  add column if not exists last_sync_error_code text,
  add column if not exists last_sync_error_message text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='integration_connections_sync_failures_nonnegative'
  ) then
    alter table public.integration_connections
      add constraint integration_connections_sync_failures_nonnegative
      check (consecutive_sync_failures >= 0);
  end if;
end $$;

create index if not exists integration_connections_provider_schedule
  on public.integration_connections(provider,status,next_sync_at,last_synced_at)
  where status='active';

update public.integration_connections
set next_sync_at=coalesce(next_sync_at,now())
where status='active'
  and provider in ('google_analytics','google_business_profile','callrail','hubspot');
