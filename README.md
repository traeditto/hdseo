# HD SEO

A production white-label SEO operating system for agencies. It converts stored SEO evidence into prioritized, assigned, approved, deployed, and measurable client work.

## What is in this foundation

- Responsive agency command center with live tenant-backed workflows
- Multi-tenant Supabase/Postgres schema with composite tenant foreign keys
- Row Level Security helpers and initial policies
- Agency and client role model
- Deterministic, transparent opportunity scoring engine
- Paid-operation confirmation UX and usage-event schema
- Architecture, data model, permissions, migration, and phased delivery documents
- Separate role-checked Admin, Agency, and Client login portals with password recovery and preview workspaces
- Unit and server-render tests
- Supabase SSR/server clients and validated server environment
- Explicit paid-provider confirmation, cost limits, usage logging, and reclaimable locks
- DataForSEO normalization and evidence snapshot persistence
- Page ownership, opportunity eligibility, deduplication, and cooldowns
- Durable campaign jobs with atomic claiming, leases, retries, and human review states
- Atomic GitHub draft-PR execution with stale-code protection and no merge capability
- Signed webhook replay protection, deployment binding, and 7/14/30/60/90 monitoring
- Enterprise GitHub App and per-agency Vercel OAuth connections
- Durable deployment queue, encrypted secrets, deployment history, validation, audit trail, and instant rollback

## Local development

Use Node.js 22 or newer, install dependencies, and run the development script. Copy `.env.example` to `.env.local` only when connecting a Supabase project or external provider. Never put real credentials in source control.

## Production setup

1. Create a Supabase project and apply `supabase/migrations` in order.
2. Configure the Supabase URL, anon key, and server-only service role key.
3. Configure the application URL and encryption key.
4. Add provider credentials only for integrations being enabled.
5. Deploy as a Next.js application and set environment variables in the hosting provider.

The integration subsystem is inactive until Supabase migrations, provider credentials, scheduler, and webhook configuration are complete. Follow [the enterprise GitHub and Vercel production runbook](docs/HD_SEO_ENTERPRISE_GITHUB_VERCEL.md) to activate it at `https://hdseo.vercel.app`.

## Product rule

Do not give agencies more raw SEO data. Turn SEO data into prioritized, assigned, approved, trackable client work.
