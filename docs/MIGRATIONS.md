# Migration order

Migrations are additive and ordered by dependency:

1. profiles, agencies, memberships, clients, client members
2. projects, services, locations, keywords, ranking snapshots
3. opportunities, drafts, tasks, integrations, usage events, audit logs
4. helper functions and Row Level Security policies
5. provider confirmations, locks, intelligence snapshots, pages, Maps, and audits
6. campaigns, durable jobs, executions, atomic webhook records, deployments, and monitoring
7. tenant RLS for the intelligence and automation tables

Never edit an applied migration. Add a new numbered migration for every schema change.
