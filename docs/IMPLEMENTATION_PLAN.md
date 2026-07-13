# Phased implementation plan

1. **Foundation — implemented:** application shell, tenant schema, RLS helpers, permission model, environment validation, Supabase clients, safe API boundaries, tests.
2. **Provider intelligence — implemented:** explicit paid confirmation, exact cost enforcement, reclaimable locks, DataForSEO normalization, snapshot persistence, usage events, readiness diagnostics.
3. **Opportunity workflow — implemented:** deterministic scoring, stable opportunity keys, ownership/conflict detection, eligibility gates, confidence, evidence snapshots, Next Best Action selection.
4. **Closed-loop jobs — implemented:** atomic claims, leases, retries, staged execution, persistent drafts/tasks, human pause states, safe error references.
5. **Repository execution — implemented:** GitHub App JWT, static inspection, atomic tree commit, stale SHA protection, approved-file validation, draft PR only.
6. **Deployment and outcomes — implemented:** signed/replay-protected webhooks, commit binding, monitoring plans, Day 7/14/30/60/90 decisions, cooldowns.
7. **Production activation — manual setup:** apply migrations, configure Supabase, create the first agency/user/client/project, configure providers and scheduler, then replace demo view models with live tenant queries.
8. **Remaining product expansion:** Google OAuth sync implementations, Stripe checkout/webhooks, client portal persistence, PDF report generation, full platform-admin UI.

## Credentials required

Supabase project keys are required to enable real authentication and persistence. DataForSEO, GitHub App, Stripe, and Resend credentials enable their corresponding phases. Google OAuth clients and approved scopes are required for Search Console, GA4, and Business Profile.

## Mocked until configured

The demonstration workspace, refresh operation, provider costs, integrations, billing, email, GitHub actions, and live ranking data are synthetic and explicitly labeled.
