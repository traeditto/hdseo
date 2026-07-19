# HD SEO outcomes, attribution, and working budgets

Migration `0024_outcomes_attribution_and_local_operations.sql` adds the production control plane that separates directional SEO estimates from actual spend and verified business outcomes.

## Google configuration

Enable these APIs in the existing Google Cloud project:

- Google Analytics Admin API
- Google Analytics Data API
- My Business Account Management API
- My Business Business Information API
- Google My Business API (review read/reply, where the account is eligible)

Add this exact authorized redirect URI to the OAuth client:

`https://hdseo.vercel.app/api/google-suite/callback`

Search Console continues to use:

`https://hdseo.vercel.app/api/google/callback`

GA4 requests read-only Analytics access. Business Profile requests `business.manage`; every profile write and review reply still requires an HD SEO approval followed by an explicit confirmed publish action.

## CallRail and HubSpot

Agency and client owners can connect provider tokens from **Results & budget**. Tokens are verified on the server and encrypted before storage. They are never returned through the API.

CallRail requires an API token and account ID. HubSpot requires a private app token with CRM object read permission. Scheduled workers import new evidence at most once per six hours.

For webhook-first CRM ingestion, configure:

`https://hdseo.vercel.app/api/webhooks/attribution/crm?projectId=<PROJECT_UUID>`

Every request must include:

- `x-hdseo-timestamp`: Unix time in milliseconds
- `x-hdseo-signature`: lowercase hex HMAC-SHA256 of `<timestamp>.<raw-body>` using `ATTRIBUTION_WEBHOOK_SECRET`
- `x-webhook-id`: stable provider delivery ID

The five-minute timestamp window and stable delivery ID prevent replay and duplicate lead creation.

## Budget meaning

The monthly SEO working budget is a hard operational ceiling, not an HD SEO charge and not a promise that the full amount will be spent. The default allocation is:

- 25% evidence and research
- 20% content
- 15% technical SEO
- 15% local SEO
- 10% authority work
- 10% implementation
- 5% software

Actual and committed transactions are recorded separately. Gross-profit return on spend appears only when both real cost and real business outcomes have been recorded.

## Required environment variables

Existing:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL=https://hdseo.vercel.app`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

New:

- `ATTRIBUTION_WEBHOOK_SECRET` — at least 24 random characters

Optional platform-managed provider defaults are supported for controlled migrations, but per-client encrypted connections are preferred:

- `CALLRAIL_API_TOKEN`
- `CALLRAIL_ACCOUNT_ID`
- `HUBSPOT_PRIVATE_APP_TOKEN`
- `HUBSPOT_CLIENT_SECRET`
- `GOOGLE_ANALYTICS_PROPERTY_ID`
- `GOOGLE_BUSINESS_ACCOUNT_ID`
- `GOOGLE_BUSINESS_LOCATION_ID`
- `CITATION_PROVIDER_API_KEY`
- `CITATION_PROVIDER_BASE_URL`

## Production acceptance

1. Apply migration 0024.
2. Deploy the application.
3. Add the Google callback and enable the APIs.
4. Connect one GA4 property and sync it.
5. Connect one Business Profile location and sync it.
6. Configure a project budget.
7. Record or import a real lead without revenue and confirm no revenue is invented.
8. Update that lead with verified revenue and gross profit.
9. Confirm scheduled provider sync is recorded in `provider_sync_runs`.
10. Draft, approve, and publish one non-destructive Business Profile test change, then verify the audit event.
11. Draft and approve a review response; publish only with the business owner's authorization.
12. Verify a duplicate webhook delivery does not create a duplicate lead.
