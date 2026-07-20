# HD SEO security and scale operations

## Safety state

Production website mutations are approval-only. `platform_security_controls` is the source of truth for the approval-only, external-mutation, provider-spend, and incident kill switches. `AUTONOMOUS_PRODUCTION_WRITES_ENABLED` remains `false` until every release gate is evidenced and approved.

The canonical authenticated application is `https://hdseo.vercel.app`. Sites/Cloudflare may serve marketing and private previews only. It must not receive Supabase service credentials, Stripe or provider credentials, OAuth secrets, encryption keys, or worker identities.

## Target operating model

- Vercel serves the portal and lightweight authenticated control-plane endpoints.
- Supabase stores tenant, authorization, budget, approval, idempotency, outbox, and current operational state.
- Google Pub/Sub distributes identifiers-only `JobEnvelopeV2` messages.
- Private Cloud Run services run webhook, evidence, crawl, agent, deployment, notification, and reporting workloads.
- Cloud Storage and BigQuery hold bounded raw evidence and partitioned history.
- Google KMS and Secret Manager isolate and rotate connector credentials.

The Terraform stack in `infra/terraform` creates this worker plane but must be applied separately to isolated staging and production Google Cloud projects. Production state uses a protected backend and an approved plan. No production apply is performed from a developer laptop.

## Release gates

1. Apply migration 0036 in staging and run `scripts/security/live-catalog-audit.sql` against the live catalog.
2. Configure Supabase CAPTCHA, email verification, Auth rate limits, an eight-hour administrator session policy, SSL enforcement, PITR, and network restrictions.
3. Configure Vercel WAF, bot protection, canonical-domain redirects, deployment protection, log drains, and OIDC federation.
4. Populate Secret Manager versions, deploy digest-pinned worker images, and run workers in shadow mode.
5. Rotate every credential that previously existed as a persistent Vercel secret after KMS-envelope cutover.
6. Run tenant-isolation, replay, SSRF, prompt-injection, dependency, SAST, DAST, load, chaos, backup-restore, and rollback tests.
7. Obtain independent penetration-test evidence and close every critical/high finding.
8. Canary 1% → 10% → 50% → 100%. Automatically stop on authorization, error, latency, queue, or cost regression.
9. Exit approval-only mode only through an audited change to `platform_security_controls`.

## Incident kill procedure

Set `incident_mode=true`, `external_mutations_disabled=true`, and `provider_spend_disabled=true` in the singleton control row. Revoke affected provider credentials, suspend relevant queues, preserve audit evidence, and start the appropriate incident runbook. Do not disable logging or delete suspect records.

## Recovery

The target is RPO ≤5 minutes and RTO <1 hour. Verify PITR monthly, restore to an isolated project, compare tenant and ledger counts, validate credential revocation status, and run a read-only acceptance suite before declaring the exercise complete. Run a regional worker failover and full disaster-recovery exercise quarterly.

## Known cutover boundary

Some compatibility handlers still use the Supabase service role on Vercel. They are temporary and must remain behind session authentication, explicit tenant checks, MFA where high-risk, global request controls, and approval-only mutations. Move each to a narrowly scoped `SECURITY DEFINER` RPC or private worker, verify parity in shadow mode, then remove `SUPABASE_SERVICE_ROLE_KEY` from Vercel. This is a hard broad-launch gate.
