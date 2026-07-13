# HD SEO Phase 0 — Architecture, Compatibility, and Safety Audit

Date: 2026-07-13  
Branch: `feature/agency-seo-os-foundation`  
Scope: repository and migration audit only; no application behavior, schema, or production deployment changed.

## Executive conclusion

HD SEO should be evolved, not rebuilt. The repository already contains a useful multi-tenant schema, Supabase authentication clients, deterministic scoring, paid-provider controls, database-backed jobs, monitoring decisions, role-oriented portals, and GitHub App primitives.

The current product is not yet a production-ready agency execution operating system. Its visible dashboards are synthetic, the manual WordPress/CMS path is absent, client-visible database policies expose internal records too broadly, and the campaign worker cannot complete its own multi-stage workflow. Repository execution was implemented before the required stabilization gate and has no default-off agency/project feature flag.

The safest first release is therefore a containment and manual-workflow foundation—not more dashboard UI and not expanded repository automation.

## 1. Current architecture

| Area | Current implementation | Assessment |
|---|---|---|
| Framework | Next.js 16.2.6 App Router, React 19.2.6, strict TypeScript | Preserve |
| Build | Vinext 0.0.50 on Vite 8 and Cloudflare Worker-compatible ESM | Preserve; validate Node APIs per deployment |
| Hosting | OpenAI Sites project with no D1 or R2 binding | Preserve; Supabase is the intended system of record |
| Package management | pnpm lockfile, Node 22+ | Preserve |
| Database | Supabase Postgres migrations `0001`–`0008` | Reuse and extend additively |
| Authentication | Supabase password sessions; separate unused Sites/ChatGPT header helper | Consolidate product auth contract before opening access |
| Authorization | RLS helpers plus server permission checks for agency APIs | Good foundation; incomplete client and platform controls |
| UI | Three login portals; Agency, Admin, and Client demonstration dashboards | Preserve visual shell; replace synthetic view models incrementally |
| Jobs | Database queue, leases, cron worker, staged handlers | Reuse after critical claim/attempt fixes |
| Providers | DataForSEO live endpoints with confirmation, cost logging, locks, normalization | Reuse after moving execution into jobs and binding confirmation scope |
| SEO engine | Deterministic score, confidence, page ownership, eligibility, selection | Reuse and extend; current evidence gates are insufficient |
| GitHub | GitHub App JWT, static reads, file SHA freshness, draft PR creation | Quarantine behind default-off gates until stabilization |
| Monitoring | 7/14/30/60/90 plans and deterministic checkpoint decisions | Reuse after manual completion/live verification support |
| Google, billing, email | Environment placeholders and synthetic UI only | Not implemented |

### Existing routes

- Public/product entry: `/`
- Login: `/login/admin`, `/login/agency`, `/login/client`
- Protected portals: `/portal/admin`, `/portal/agency`, `/portal/client`
- Synthetic previews: `/portal/*/preview`
- Authentication check: `/api/auth/portal-access`
- Paid data: `/api/data/confirm`, `/api/data/:operation`
- Campaigns and jobs: `/api/campaigns/generate`, `/api/jobs/:jobId`, `/api/jobs/:jobId/review-opportunity`
- Repository review: `/api/executions/:executionId/review`
- Readiness and workers: `/api/system/readiness`, `/api/cron/seo`
- Webhooks: `/api/webhooks/github`, `/api/webhooks/vercel`

No existing route should be removed or renamed. New behavior should be introduced through compatible response extensions, feature flags, and new routes.

## 2. Existing data model to preserve

### Strong reusable tenant foundation

- `profiles`
- `agencies`
- `agency_members`
- `client_organizations`
- `client_members`
- `agency_branding`
- `agency_domains`
- `platform_admins`
- `seo_projects`
- `seo_services`
- `seo_locations`
- `seo_keywords`

The hierarchy already matches Platform → Agency → Client → Project. Composite agency/client/project foreign keys are used in the original SEO tables and should remain the standard for every new tenant-owned relation.

### Reusable SEO evidence and workflow tables

- `organic_ranking_snapshots`
- `keyword_metric_snapshots`
- `competitor_domains`
- `seo_page_snapshots`
- `maps_rank_snapshots`
- `site_audits`
- `audit_findings`
- `seo_opportunities`
- `seo_action_drafts`
- `seo_tasks`
- `seo_campaigns`
- `seo_campaign_jobs`
- `seo_campaign_candidates`
- `seo_executions`
- `seo_monitoring_plans`
- `seo_monitoring_checkpoints`
- `data_provider_connections`
- `data_usage_events`
- `provider_operation_confirmations`
- `provider_job_locks`
- `audit_logs`

### Normalization required without destructive replacement

| Existing area | Problem | Compatibility treatment |
|---|---|---|
| `keyword_metrics` and `keyword_metric_snapshots` | Two overlapping metric stores; application reads snapshots | Keep both, declare snapshots canonical, backfill if needed, then add a compatibility view |
| `seo_action_drafts.execution_path` | Only `repository` or `instruction` | Add new allowed paths; map legacy `instruction` to generic/manual behavior |
| `seo_action_type` enum | Missing CTR, wrong-page, evidence, conversion, and query expansion types | Add enum values in an additive migration |
| Status columns | Many free-form text fields | Add transition validation gradually after auditing production values |
| Scalar cross-table FKs in migrations 5–6 | Can associate rows across tenants when service role writes | Add composite unique keys and tenant-matching constraints; validate before enforcing |
| Project/domain relationship | One domain is embedded in `seo_projects` | Preserve columns and add `websites` for multi-site/canonical/CMS support |

## 3. Authentication and authorization audit

### What is sound

- Supabase server sessions call `auth.getUser()` rather than trusting browser identity.
- Browser-supplied tenant IDs are rechecked against agency membership and active projects.
- Paid and execution APIs use explicit permission checks.
- The service-role key is server-only.
- Core RLS helpers use authenticated user membership.
- Platform admin and client/agency portals perform server-side role lookup.

### Release-blocking risks

1. **Client data exposure through broad RLS.** `has_client_access` is used for full-row reads of campaigns, jobs, opportunities, drafts, tasks, repository connections, executions, and monitoring plans. A client can consequently receive internal notes, budgets, assumptions, raw job errors/results, repository metadata, and `encrypted_secret_reference` values when querying Supabase directly. Client visibility needs dedicated projections or client-safe tables/policies.
2. **Service-role writes weaken tenant guarantees.** Several later tables use scalar foreign keys rather than agency/client/project composite keys. Since server workers bypass RLS, database constraints must enforce tenant consistency.
3. **Mutating tenant context can select an arbitrary first project.** `requireProject: true` does not require an explicit project ID. Mutations must fail closed when project identity is missing.
4. **Unvalidated cross-tenant `campaignId`.** Campaign generation validates the selected project but does not verify that an optional campaign belongs to that project before service-role insertion.
5. **Client authorization is not integrated into domain APIs.** The Client portal can authenticate, but client approvals, evidence requests, and reports have no real API workflow.
6. **Incomplete account lifecycle.** Invitation acceptance, signup/profile creation, password-update completion, suspension enforcement, and workspace selection are incomplete.
7. **Two identity concepts exist.** Supabase product authentication and the unused Sites/ChatGPT authenticated-header helper are not joined. The production access policy must be chosen deliberately to avoid double-login or inaccessible external clients.
8. **No real RLS integration tests.** Current tests inspect source strings and pure functions; they do not execute policies as two agencies and two clients.

## 4. Database and migration audit

### Applied order to preserve

1. `0001_tenants.sql`
2. `0002_seo_data.sql`
3. `0003_workflows.sql`
4. `0004_rls.sql`
5. `0005_provider_intelligence.sql`
6. `0006_campaign_execution.sql`
7. `0007_intelligence_rls.sql`
8. `0008_portal_access.sql`

Never edit these after production use. All corrections should start at `0009` and include preflight checks/backfills where constraints are added.

### Critical migration findings

- The job-claim functions revoke execution from `public`, `anon`, and `authenticated` but do not explicitly grant execution to `service_role`. The cron worker may be unable to claim work in a real Supabase deployment.
- `attempt_count` increments on every successful stage claim while `max_attempts` defaults to three. A ten-stage campaign becomes unclaimable after its third stage. Attempts must be tracked per stage/failure, not per successful workflow step.
- `keyword_metric_snapshots.keyword_id`, Maps keywords, audit findings, candidates, executions, monitoring relations, and campaign relations need tenant-matching constraints or server validation hardening.
- `data_usage_events.confirmation_id` is not a foreign key.
- No automatic `updated_at` maintenance exists.
- No immutable database protection prevents service-role updates/deletes of audit records.
- Agency branding and tenant administration have read policies but no complete write workflow.
- Client visibility is row-based instead of field/record publication-based.

## 5. SEO evidence and opportunity engine audit

### Reusable behavior

- Numeric opportunity scores are deterministic.
- Missing data reduces confidence.
- Ranking proximity lets a high-value position-six keyword beat a broad position-38 keyword.
- Page ownership, duplicate titles, cannibalization, and canonical conflicts are considered.
- Eligibility is separated from score.
- Stable opportunity keys, active deduplication, confidence-adjusted selection, and cooldowns exist.
- Monitoring language avoids causal claims.

### Gaps and unsafe assumptions

- Only eight action types exist; the required CTR, wrong-page, conversion, query-expansion, and evidence-request types are missing.
- The returned score lacks implementation path, effort, data cost, risk, dependencies, and status detail required by the master product contract.
- Service/location relevance is inferred from foreign-key presence rather than actual stored priority.
- Competitor gap becomes a constant score when any competitor exists rather than keyword-specific evidence.
- Absence of page snapshots can become `BUILD` instead of “page evidence unavailable.”
- DataForSEO “relevant pages” rows currently contain empty title, heading, link, and schema evidence; these rows cannot establish page ownership safely.
- No evidence freshness gate prevents old rankings or audits from driving a new action.
- The requested minimum confidence and automation mode are stored in job input but ignored during scoring/execution.
- There is no action dependency graph or Information Value Score.
- No first-party Search Console evidence exists.

## 6. Jobs, paid providers, and monitoring audit

### Reusable behavior

- Atomic `FOR UPDATE SKIP LOCKED` claims and leases exist.
- Stage transitions are persisted.
- Idempotency keys and structured user-safe errors exist.
- Human pauses exist before opportunity and file execution.
- Monitoring checkpoints consume stored rankings and can return inconclusive, wrong-page/technical, decline, or milestone decisions.

### Release blockers

- The stage-attempt defect prevents the campaign workflow from completing.
- DataForSEO live work runs inside the initiating HTTP request instead of a durable worker.
- Confirmation matching checks operation, user, units, and estimated cost, but not a canonical hash of the actual keyword/target/location payload. A same-size different scope can reuse the approval.
- Heartbeats are not renewed during long stages.
- Retry/idempotency is incomplete for remote side effects such as branch creation.
- Readiness only counts six evidence types and treats any-age evidence as usable.
- There is no manual implementation verification, so monitoring can start only from repository deployment.
- Monitoring has no URL indexability/canonical/live-content gate.

## 7. Manual CMS, WordPress, tasks, approvals, and client workflow

This is the largest business gap.

- `seo_action_drafts` and `seo_tasks` are useful seeds, but the only implemented draft path is repository execution.
- `prepareStage` always creates `execution_path: repository`.
- Opportunity approval always advances to repository inspection.
- No WordPress modes, CMS connection records, content package schema, copy/HTML/JSON-LD exports, Yoast/Rank Math fields, or developer ticket package exist.
- No task approval, task evidence, attachment, revision, or completion-verification tables exist.
- No verified business evidence vault or evidence-request workflow exists.
- Client portal dashboards and approvals are synthetic.
- Reports, proof-of-work timeline, notifications, and white-label exports are synthetic or absent.

The platform is therefore not yet sellable for non-repository clients, even though the schema and visual shell provide a strong starting point.

## 8. GitHub and deployment audit

### Valuable primitives to preserve

- GitHub App authentication rather than personal tokens.
- Static repository inspection; client code is not executed during inspection.
- Original file SHA and base commit tracking.
- Human-edited content takes precedence.
- Freshness is rechecked before PR creation.
- Changes are made on a feature branch and PRs are draft-only.
- No merge operation exists.
- Signed webhook and delivery replay records exist.
- Production commit matching gates monitoring.

### Mandatory containment

- There is no `repository_execution_enabled` flag at platform, agency, or project scope.
- `EXECUTE_WITH_APPROVAL` can reach a real PR before the required manual-workflow stabilization gate.
- Validation currently checks only approval state, a narrow secret pattern, content presence, and original SHA. It does not run the required type, lint, test, build, route, schema, metadata, robots, sitemap, accessibility, or business-claim gates.
- Remote branch/commit/PR side effects are not fully retry-idempotent.
- UI and documentation overstate execution readiness.
- Vercel signature verification and event parsing must be confirmed against the current official webhook contract before production activation.

Repository execution should remain in the codebase but be unreachable by default until `GITHUB_EXECUTION_READINESS.ready` is true and both agency and project flags are enabled.

## 9. Missing product capabilities

| Capability | State |
|---|---|
| Multi-tenant schema | Strong foundation; hardening required |
| White-label schema | Foundation exists; real settings and branded outputs missing |
| Agency dashboard | Synthetic interactive shell |
| Client projects | Schema exists; real CRUD/project workspace missing |
| Data readiness | Partial, incomplete response contract, no freshness |
| Durable jobs | Foundation exists; critical attempt defect |
| Opportunity engine | Deterministic partial implementation |
| Next Best Action | Selection exists; full explanation/defer/dependencies missing |
| Evidence package | Stored JSON only; no complete evidence page |
| Dependency graph | Missing |
| WordPress/manual packages | Missing |
| Evidence vault | Missing |
| Task approvals/evidence | Missing |
| Client approval portal | Visual shell only |
| Live verification | Missing for manual clients |
| Monitoring | Repository-only foundation |
| SEO experiments/outcomes | Missing |
| Search Console/URL Inspection | Missing |
| GA4/leads/revenue | Missing |
| Local/review intelligence | Maps table only |
| AI visibility | Missing |
| Risk budgets/playbooks | Partial campaign JSON only |
| Billing/entitlements | Environment placeholders only |
| Notifications/reports | Synthetic UI only |
| Immutable proof-of-work timeline | Missing |
| GitHub execution | Premature partial implementation; must be gated |

## 10. Highest-risk destabilization points

| Priority | Risk | Required response |
|---|---|---|
| P0 | Client RLS exposes internal records and repository secret references | Replace direct client reads with publication-safe policies/views |
| P0 | Job workflow stops after three stage claims | Correct attempt semantics and add end-to-end worker tests |
| P0 | Repository execution has no stabilization feature flag | Default-off platform/agency/project gates and readiness function |
| P0 | Manual/WordPress workflow is absent | Build it before further GitHub expansion |
| P0 | Claim RPC may not be executable by service role | Explicit least-privilege grant and database verification |
| P1 | Paid confirmation does not bind exact payload | Canonical scope hash and one-time consumption |
| P1 | Service-role cross-tenant associations are not fully constrained | Composite FKs and scoped server repositories |
| P1 | Scoring can interpret missing/empty page evidence as ownership or BUILD evidence | Require fresh, complete page evidence or emit evidence request |
| P1 | Real dashboards and client approval APIs are absent | Replace demo data incrementally after safe domain APIs exist |
| P1 | Authentication lifecycle and hosting access policy are incomplete | Define external-user production auth and invite/recovery flow |
| P2 | Docs/UI describe incomplete integrations as ready | Add capability/readiness states derived from real configuration |

## 11. Recommended additive migration sequence

The exact contents require a live production-schema preflight before application, but the safe numbering and responsibilities are:

1. **`0009_safety_gates_and_job_repair.sql`** — repository feature flags default false; GitHub readiness requirements; corrected job attempt/claim semantics; explicit service-role RPC grants; paid-confirmation consumption/scope hash; tenant consistency preflight helpers.
2. **`0010_client_visibility_and_rls_hardening.sql`** — client publication controls; remove broad client reads from internal campaign/job/repository fields; client-safe views or tables; actual isolation policies.
3. **`0011_websites_cms_and_risk_controls.sql`** — websites, CMS connections, implementation path settings, risk budgets, agency/project entitlements.
4. **`0012_business_evidence_and_dependencies.sql`** — verified business evidence, evidence requests, opportunity dependency edges, publication scopes.
5. **`0013_manual_implementation_packages.sql`** — WordPress/generic/developer packages, package artifacts, acceptance criteria, exports, versioning.
6. **`0014_task_approvals_verification_timeline.sql`** — approvals, task evidence, completion proof, live verification, proof-of-work events.
7. **`0015_manual_monitoring_and_experiments.sql`** — manual implementation → verified live state → checkpoints, experiments, confounders, outcome records.
8. **`0016_search_console_and_indexing.sql`** — OAuth connections, GSC evidence, URL Inspection state.
9. **Later additive migrations** — GA4/business outcomes, local/review intelligence, AI visibility, billing, reports, notifications, playbooks, and only then repository execution expansion.

## 12. Phased implementation plan

### Phase A — Safety containment and database test harness

- Keep every route and table.
- Add default-off GitHub flags and `GITHUB_EXECUTION_READINESS`.
- Route all current approvals to manual preparation unless readiness and both feature flags pass.
- Repair job attempts, service-role RPC permissions, exact paid scope confirmation, and tenant constraints.
- Add a real Supabase test environment with two agencies, two clients, forged IDs, role escalation, and client-field isolation tests.

Exit gate: all P0 security and worker tests pass.

### Phase B — Sellable manual and WordPress execution system

- Add websites/CMS settings and WordPress modes.
- Add verified business evidence and evidence requests.
- Add dependency-aware selection.
- Generate versioned WordPress, generic CMS, and developer ticket packages.
- Add agency/client approval, assignment, proof, live URL verification, exports, and proof-of-work events.

Exit gate: one complete non-repository client workflow succeeds end to end.

### Phase C — Real agency and client product

- Replace synthetic agency/admin/client view models with tenant-safe server queries.
- Implement client/project CRUD, team invitations, work queue filters, evidence pages, Kanban/list views, branded settings, and real client approval.
- Add branded reports and notifications from immutable events.

Exit gate: production users can operate without demo state or direct database access.

### Phase D — Evidence expansion and outcomes

- Complete readiness/freshness.
- Move all paid collection into durable jobs.
- Add Search Console, URL Inspection, experiments, outcomes, Maps/review intelligence, and optional GA4/business outcomes.

Exit gate: monitoring records evidence quality and confounders without causal claims.

### Phase E — Stabilization

- Observe at least one complete manual workflow.
- Review incidents, audit completeness, worker recovery, client visibility, and entitlements.
- Return a stored `GITHUB_EXECUTION_READINESS` result.

### Phase F — Premium repository execution

- Enable only per entitled agency and verified project.
- Expand validation into isolated checks and GitHub Checks.
- Make branch/PR side effects idempotent.
- Preserve human edits and stale-code blocking.
- Track preview, merge, production commit, live verification, then monitoring.

## 13. Tests required before production activation

Current result: install, typecheck, lint, 18 unit/structure tests, Vinext production build, and 3 rendered-route tests pass.

The current suite does **not** prove production readiness. Add:

- Migration application tests on a real disposable Postgres/Supabase instance.
- RLS tests as Agency A, Agency B, Client A, Client B, viewer, approver, and service role.
- API IDOR tests with forged agency/client/project/campaign/job/execution IDs.
- Job tests covering more than three stages, lease expiry, heartbeat, retries, timeout, and idempotency.
- Exact paid-scope reuse/replay tests.
- WordPress packages for Gutenberg, Elementor, Yoast, Rank Math, HTML, and JSON-LD.
- Agency/client approval, evidence, revision, completion, and failed verification tests.
- Day 7/14/30/60/90, wrong page, deindexation, and inconclusive monitoring tests.
- Feature-flag and readiness tests proving GitHub is disabled by default and cannot be bypassed.

## 14. Environment and manual setup

### Existing variables

- Supabase URL, anon key, service role
- DataForSEO credentials and cost/volume limits
- GitHub App credentials and webhook secret
- Vercel project/webhook values
- Stripe and Resend placeholders
- Cron and application encryption secrets
- Platform admin allowlist

### Required before live database verification

- A non-production Supabase project containing a production-like migration/data snapshot.
- Service-role access for migration and worker tests.
- Test identities for two agencies and two clients.
- Confirmation of which existing migrations have already been applied in production.
- A decision on public/external Supabase login versus workspace-only Sites access.

No real Supabase credentials were present during this audit, so live data, applied migration state, policy behavior, and production record compatibility were not inspected. Those are mandatory before applying `0009`.

## 15. Phase 0 final report

1. **Architecture completed:** full repository, route, integration, worker, scoring, auth, and migration inventory.
2. **Files created:** this audit report only.
3. **Files modified:** none.
4. **Migrations added:** none.
5. **Migration order:** preserve `0001` through `0008`; proposed additive sequence begins at `0009`.
6. **RLS:** reusable helper foundation; client publication and service-role constraint gaps are release blockers.
7. **Roles:** agency and client roles exist; real client workflows and platform administration remain incomplete.
8. **Tests added:** none in Phase 0.
9. **Test results:** all 18 current unit/structure tests and 3 render tests pass.
10. **Build results:** typecheck, lint, frozen install, and production Vinext build pass.
11. **Environment:** variable structure is present; no live credentials were used.
12. **Manual setup:** disposable Supabase validation environment and applied-migration inventory required.
13. **Known limitations:** synthetic UI, incomplete manual workflow, no live DB validation, premature GitHub path.
14. **Stabilization risks:** tenant leakage, worker exhaustion, incomplete paid authorization, unsafe evidence assumptions.
15. **Recommended next phase:** Phase A safety containment and database integration-test harness.

## Decision requested

Approve Phase A only. Do not start WordPress UI, Google integrations, or additional GitHub work until the containment migration, job repairs, client visibility policies, and real multi-tenant tests are complete.
