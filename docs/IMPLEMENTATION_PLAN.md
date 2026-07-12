# Phased implementation plan

1. **Foundation (implemented here):** application shell, tenant schema, core RLS helpers, permission model, architecture, deterministic scoring, demo experience, tests.
2. **Brand and command center:** persisted branding tokens, hostname resolution, dashboard query layer, onboarding.
3. **SEO data collection:** manual entry, encrypted provider references, explicit paid-operation confirmation, jobs, usage summaries.
4. **Opportunity workflow:** stored scoring inputs, page ownership/conflict checks, Next Best Action queues, evidence snapshots.
5. **Execution workflow:** drafts, tasks, human edits, approvals, client evidence requests, notifications.
6. **Portal and reports:** client visibility controls, live and PDF reports, scheduled delivery.
7. **Repository execution:** GitHub App, static inspection, stale SHA checks, validation, draft pull requests.
8. **Outcomes and billing:** ranking checkpoints, subscriptions, entitlements, limits, platform admin.

## Credentials required

Supabase project keys are required to enable real authentication and persistence. DataForSEO, GitHub App, Stripe, and Resend credentials enable their corresponding phases. Google OAuth clients and approved scopes are required for Search Console, GA4, and Business Profile.

## Mocked until configured

The demonstration workspace, refresh operation, provider costs, integrations, billing, email, GitHub actions, and live ranking data are synthetic and explicitly labeled.
