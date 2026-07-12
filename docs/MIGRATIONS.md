# Migration order

Migrations are additive and ordered by dependency:

1. profiles, agencies, memberships, clients, client members
2. projects, services, locations, keywords, ranking snapshots
3. opportunities, drafts, tasks, integrations, usage events, audit logs
4. helper functions and Row Level Security policies

Never edit an applied migration. Add a new numbered migration for every schema change.
