# SEO Agency OS

A standalone, white-label SEO operating system for agencies. It converts stored SEO evidence into prioritized, assigned, approved, and measurable client work.

## What is in this foundation

- Responsive agency command center with clearly labeled synthetic demo data
- Multi-tenant Supabase/Postgres schema with composite tenant foreign keys
- Row Level Security helpers and initial policies
- Agency and client role model
- Deterministic, transparent opportunity scoring engine
- Paid-operation confirmation UX and usage-event schema
- Architecture, data model, permissions, migration, and phased delivery documents
- Unit and server-render tests

## Local development

Use Node.js 22 or newer, install dependencies, and run the development script. Copy `.env.example` to `.env.local` only when connecting a Supabase project or external provider. Never put real credentials in source control.

## Production setup

1. Create a Supabase project and apply `supabase/migrations` in order.
2. Configure the Supabase URL, anon key, and server-only service role key.
3. Configure the application URL and encryption key.
4. Add provider credentials only for integrations being enabled.
5. Deploy as a Next.js application and set environment variables in the hosting provider.

The live demonstration does not execute paid provider requests. DataForSEO, Google, GitHub, Stripe, and Resend are intentionally represented by secure foundations until credentials and provider applications are configured.

## Product rule

Do not give agencies more raw SEO data. Turn SEO data into prioritized, assigned, approved, trackable client work.
