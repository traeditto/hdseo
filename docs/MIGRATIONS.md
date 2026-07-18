# Migration order

Migrations are additive and ordered by dependency:

1. profiles, agencies, memberships, clients, client members
2. projects, services, locations, keywords, ranking snapshots
3. opportunities, drafts, tasks, integrations, usage events, audit logs
4. helper functions and Row Level Security policies
5. provider confirmations, locks, intelligence snapshots, pages, Maps, and audits
6. campaigns, durable jobs, executions, atomic webhook records, deployments, and monitoring
7. tenant RLS for the intelligence and automation tables
8. platform administrator identities and Admin, Agency, and Client portal access

Never edit an applied migration. Add a new numbered migration for every schema change.
## 0016 — production evidence control plane

Apply `0016_evidence_control_plane.sql` after `0015_live_portal_security_and_publications.sql`. It is required for the Admin system-readiness page, Google Search Console OAuth state consumption, evidence queue jobs, crawler snapshots, freshness policies, and worker heartbeats. It does not replace or backfill existing campaign, deployment, or portal tables.

Apply `0019_production_readiness_control_plane.sql` after `0018_competitive_creative_engine.sql`. It records complete crawl-to-report production acceptance runs and their required evidence steps. The Admin readiness badge remains `PILOT ONLY` until this migration exists and at least one production acceptance run succeeds.

Apply `0020_cms_publication_control_plane.sql` after `0019_production_readiness_control_plane.sql`. It stores idempotent WordPress, Shopify, and Webflow writes with immutable before/after snapshots and rollback evidence.
