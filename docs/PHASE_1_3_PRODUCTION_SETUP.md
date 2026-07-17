# HD SEO evidence loop: Phase 1–3 production setup

This release adds the production readiness control plane, Google Search Console evidence collection, and a bounded public-site crawler. It is additive and keeps Supabase as the system of record.

## Required database step

Apply `supabase/migrations/0016_evidence_control_plane.sql` to the production Supabase project before using Search Console or crawling. The migration adds tenant-scoped evidence runs, freshness policy, operational heartbeats, OAuth replay protection, and evidence queue scope.

## Required Vercel variables

Set these in Production and Preview as appropriate:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_ENCRYPTION_KEY` (the existing 32+ character key; do not rotate without a secret migration)
- `CRON_SECRET` (the existing scheduler secret)

Google Cloud OAuth must allow this exact callback URL:

`https://hdseo.vercel.app/api/google/callback`

The requested Google scopes are Search Console read-only plus OpenID/email for connection attribution. No Search Console write scope is requested.

## Runtime behavior

- Agency → Websites → Connect Google Search Console starts signed OAuth scoped to the selected project.
- The callback consumes the state exactly once, encrypts the refresh token with AES-256-GCM, discovers properties, and auto-selects a matching `sc-domain:` or URL property when available.
- Search Console refresh, sitemap collection, URL Inspection, and crawling are durable `evidence` queue jobs. They retry with bounded exponential backoff and move to `dead_letter` after the configured attempt limit.
- Search Console impressions remain first-party visibility evidence. They are never stored or displayed as search volume.
- The crawler only follows public HTTPS/HTTP pages on the connected canonical domain, validates DNS on every redirect, respects `robots.txt`, caps response bodies at 2 MB, caps pages by policy, and records HTTP/page/metadata/schema/link/indexability evidence.
- Existing keyword records no longer bypass evidence refresh forever. The discovery stage requires fresh rankings, metrics, and page snapshots or queues the missing collection first.

## Verification checklist

1. Open Admin → System readiness and confirm the database tables are `READY`.
2. Confirm the scheduler heartbeat appears after the next `/api/cron/seo` execution.
3. Add a client website, then connect its Google Search Console property.
4. Select the property if more than one is returned.
5. Run Search Console refresh and Crawl website. Confirm evidence runs and queue jobs complete.
6. Start automatic discovery. No keyword field should be required.
7. Confirm the top opportunity shows stored evidence and that stale evidence causes a refresh queue rather than being silently reused.

## Opt-in Supabase integration tests

The tenant isolation suite runs against a disposable test project only when all of these are set: `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD`, `TEST_PROJECT_A_ID`, and `TEST_PROJECT_B_ID`. It signs in user A and verifies RLS cannot return user B's project.
