# HD SEO autonomous outcome loop

The production loop is intentionally bounded. Research and validation may run
automatically; paid data, content claims, repository files, publishing, DNS,
and rollback remain governed by tenant permissions, spending limits, and human
approval.

## Runtime sequence

1. The SEO scheduler atomically claims due project evidence policies and
   recovers expired worker leases.
2. Search Console, sitemap, URL inspection, crawl, ranking, keyword, competitor,
   service-area, GA4, attribution, and budget evidence are stored by tenant.
3. Candidate opportunities are filtered by market scope and safety eligibility.
4. The decision engine combines SEO potential, evidence confidence, observed
   conversion economics, implementation cost, and expected gross profit.
5. HD SEO presents one recommendation in plain language, including assumptions,
   expected value, exact proposed work, risk, and the approval question.
6. Repository work uses either a deterministic safe edit or a human-approved,
   QA-passed Creative Studio draft. Unsupported claims cannot enter generated
   page code.
7. Approved files are committed atomically to an `hd-seo/*` branch and opened as
   a draft pull request.
8. A connected Vercel project receives a preview deployment. Health, metadata,
   internal links, schema, Lighthouse, sitemap, robots, indexing readiness, and
   drift checks run before final review.
9. HD SEO never merges the pull request or publishes production code without an
   authorized repository decision. The GitHub and Vercel webhooks bind the
   resulting production commit to the execution.
10. Monitoring compares rankings, Search Console, GA4, leads, qualified leads,
    revenue, gross profit, and recorded spend against the pre-change window.
11. Checkpoints recommend `KEEP`, `IMPROVE`, `ROLLBACK_RECOMMENDED`, or
    `CONTINUE`. Rollback is a recommendation until an authorized user approves
    it; production validation can still invoke an already-configured automatic
    rollback for a technically failed deployment.

## Required rollout order

1. Apply `supabase/migrations/0025_autonomous_outcome_loop.sql` with the service
   role migration workflow.
2. Deploy the application.
3. Confirm both cron heartbeats and at least one claimed evidence policy.
4. Verify a client has Search Console, GA4, attribution, repository, and Vercel
   project mappings before running the end-to-end acceptance test.
5. Start with a low-risk metadata change and confirm: opportunity approval,
   exact-file approval, draft PR, healthy preview, manual merge, production
   webhook, monitoring plan, and outcome recommendation.

## Enterprise controls

- Atomic policy and queue claims use `FOR UPDATE SKIP LOCKED`.
- Hour-bucketed evidence idempotency keys prevent duplicate provider work.
- Expired leases become bounded retries or dead letters.
- Dead letters require an authenticated platform administrator to replay.
- Tenant IDs are carried on evidence, jobs, deployments, outcomes, and audit
  records.
- Forecasts are directional and retain their assumptions; measured outcomes are
  reported separately and never presented as proof of causation.
