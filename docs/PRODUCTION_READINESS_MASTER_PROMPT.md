# HD SEO production completion master prompt

Use this prompt when continuing production work on HD SEO. It is an execution
contract, not a request to add demo UI.

## Objective

Complete HD SEO as an evidence-driven, agent-first SEO operating system for
agencies and business owners. A feature is complete only when it operates on
real tenant data, enforces authorization and spending controls, records an
audit trail, survives retry, validates its result, and exposes failure clearly.

## Production rule

Never describe a provider as autonomous because credentials can be verified.
Read, draft, publish, validate, rollback, and monitoring are separate
capabilities and must be displayed separately. Never substitute checkboxes,
synthetic records, or configuration presence for successful execution.

## Required end-to-end workflow

For a real client and project:

1. Detect the website and connection method.
2. Crawl bounded public pages safely.
3. Import Search Console queries, pages, sitemaps, and inspection evidence.
4. Discover keywords without requiring a client keyword list.
5. Score opportunities using demand, commercial intent, proximity, difficulty,
   relevance, technical readiness, evidence freshness, effort, and budget.
6. Let the supervisor assign bounded work to specialized agents.
7. Generate proof-backed strategy, creative specifications, and implementation.
8. Request human approval for publishing, spending, deployment, DNS, legal,
   pricing, destructive, and high-risk actions.
9. Publish through a genuinely supported CMS or GitHub pathway.
10. Create a preview or draft and preserve the prior revision.
11. Run independent live QA for HTTP health, expected content, metadata,
    canonical, schema, links, robots, sitemap, indexing, Lighthouse, and drift.
12. Publish production only after required checks pass.
13. Schedule 7/14/30/60/90-day monitoring.
14. Report impressions, clicks, CTR, position, leads, conversions, spend, and
    value without claiming unsupported causation.
15. Keep a tested one-click rollback path.

## Engineering requirements

- Tenant isolation in database policy and service-role queries.
- Role and tool-specific permissions.
- Signed, expiring, single-use OAuth state.
- Encrypted secrets with versioned rotation support.
- Idempotent mutations and provider writes.
- Durable queues, bounded retries, dead-letter repair, and replay tools.
- Scheduler heartbeats independent of job activity.
- Structured logs, reference IDs, traces, metrics, and operational alerts.
- Transactional onboarding and integration binding.
- Append-only audit evidence.
- Staging, CI, integration tests, browser end-to-end tests, backups, and restore drills.
- Honest readiness states derived from execution evidence.

## Release gates

Do not call the system production ready until a real project has three
consecutive successful production acceptance runs, a rollback drill, tenant
isolation tests, and a database restore drill. Public self-service additionally
requires invitations, email, billing, entitlements, account lifecycle, privacy,
terms, support, and abuse controls. Enterprise additionally requires SSO/SCIM,
audit export, security testing, recovery objectives, service levels, and load
testing.

## Current implementation order

1. Worker and scheduler reliability.
2. Search Console data production and zero-row diagnostics.
3. Automated production acceptance runs.
4. Model-backed proof-gated creative generation.
5. GitHub/Vercel production path and rollback drill.
6. WordPress, Shopify, and Webflow publishers with revision rollback.
7. Outcome attribution and reporting.
8. CI, staging, observability, recovery, invitations, billing, and enterprise controls.
