# HD SEO closed-loop automation

## Safety invariants

- Browser IDs are selectors, never authorization.
- Every operation resolves authenticated agency membership and project ownership server-side.
- Paid calls require an unexpired confirmation with the same operation, units, cost, user, agency, and project.
- Dashboard loads never call a paid provider.
- Scoring is deterministic and consumes stored evidence.
- Page ownership is evaluated before any BUILD action.
- Human review pauses both opportunity execution and file execution.
- Approved content takes precedence over human-edited content, which takes precedence over generated content.
- Repository code is inspected statically and never executed by the inspection service.
- Pull requests are draft-only. HD SEO contains no automatic merge operation.
- Monitoring starts only after a verified production deployment contains the merged commit.

## Production activation

1. Apply migrations `0001` through `0007` to a new Supabase project.
2. Reload the PostgREST schema cache.
3. Configure the Supabase public and server-only keys.
4. Create the first agency owner, agency, client, and SEO project.
5. Configure DataForSEO and set an agency budget limit.
6. Configure `CRON_SECRET` and call `/api/cron/seo` from a protected scheduler.
7. Install the GitHub App with repository metadata, contents, pull-request, and webhook access; do not grant merge automation.
8. Configure signed GitHub and deployment webhooks.
9. Verify agency, client, project, paid-operation, job, execution, and webhook isolation before enabling production users.

## Known activation boundary

The private deployed demonstration remains synthetic until a Supabase project and provider credentials are configured. The backend returns safe `NOT_CONFIGURED` responses rather than fabricating live data.
