# SEO Agency OS architecture

## System boundary

This repository is a standalone multi-tenant application. It does not import, modify, or depend on a client website repository. Client repositories are external resources accessed only through a future GitHub App installation.

## Application layers

- **Presentation:** Next.js App Router pages and controlled white-label theme tokens.
- **Application:** server actions or route handlers that validate input, resolve the authenticated user, load tenant membership from the database, and authorize the requested capability.
- **Domain:** deterministic SEO scoring, page ownership, task state machines, execution planning, billing entitlements, and reporting.
- **Data:** Supabase Postgres with Row Level Security on every tenant-owned table. The browser receives only the anon key.
- **Jobs:** idempotent workers for authorized provider collection, audits, ranking snapshots, notifications, and outcome checkpoints.
- **Integrations:** provider interfaces for DataForSEO, Google, GitHub, Stripe, and Resend. Secrets are referenced from encrypted storage and never returned to the browser.

## Request security invariant

Every tenant operation resolves agency membership from the authenticated user. Browser-supplied agency, client, or project IDs are treated as selectors, not authorization. Postgres RLS repeats the isolation guarantee. Paid operations additionally require an explicit confirmation record, entitlement check, estimated scope/cost, and usage event.

## Deployment

The application remains compatible with a standard Next.js deployment. The included Sites adapter provides a working demonstration surface; Supabase remains the production system of record. Provider integrations remain mocked until credentials and OAuth applications are configured.
