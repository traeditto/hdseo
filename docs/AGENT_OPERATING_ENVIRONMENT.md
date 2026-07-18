# HD SEO Agent Operating Environment

HD SEO is agent-first internally and results-first for customers. Agents never receive unrestricted database or integration access. Every unit of work is a durable, tenant-scoped work item with a declared goal, evidence, plan, tool allowlist, spending ceiling, risk class, approval policy, steps, validation, and final outcome.

## Runtime

- agent_definitions and agent_tool_grants are the capability registry.
- agent_work_items and agent_work_steps are the shared execution contract.
- agent_approvals is the unified human approval inbox.
- agent_memory stores scoped facts, decisions, evidence summaries, outcomes, and lessons.
- agent_tool_executions is the tool-level cost and authorization trail.
- agent_activity_events is the client/project proof-of-work timeline.
- The agents background queue is claimed with FOR UPDATE SKIP LOCKED by the existing protected automation cron.
- The supervisor enforces tenant scope, role permissions, tool grants, monthly and per-work-item budgets, risk ceilings, approval gates, idempotency, bounded evidence waits, retries, and dead letters.

Publishing, deployment, rollback, DNS, legal, pricing, and destructive tools are request-only. They cannot be queued without approval requirements, and the implementation service cannot execute an undeclared tool. Existing deployment validation and automatic rollback remain the production execution safety layer.

## Production rollout

1. Apply supabase/migrations/0017_agentic_control_plane.sql.
2. Deploy the application revision containing /api/agents/workspace.
3. Confirm CRON_SECRET is configured and Vercel invokes /api/cron/automation.
4. Open **Agency → Agent Workspace**, select one project, and run the team with a small paid-research limit.
5. Confirm the agents heartbeat becomes healthy in **Admin → System readiness**.
6. Confirm work items advance, evidence waits requeue, approvals pause protected work, and the money-used total matches audited provider/tool costs.
7. Confirm a repeated onboarding launch does not duplicate work because each work item has an agency-scoped idempotency key.

No new secrets are introduced by this control plane. Provider credentials remain in the existing encrypted, tenant-scoped connection stores.
