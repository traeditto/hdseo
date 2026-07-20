-- PostgREST upserts generate ON CONFLICT(project_id,source,external_id).
-- A partial unique index cannot be inferred by that conflict target, which
-- caused verified CallRail and HubSpot records to fail after provider reads.
-- PostgreSQL unique indexes already allow multiple null external IDs, so the
-- non-partial index preserves manual/unidentified leads while making provider
-- ingestion atomic and idempotent.

drop index if exists public.seo_leads_external_identity;
create unique index seo_leads_external_identity
  on public.seo_leads(project_id,source,external_id);
