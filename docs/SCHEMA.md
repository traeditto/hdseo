# Data model and tenancy

```mermaid
erDiagram
  AGENCIES ||--o{ AGENCY_MEMBERS : has
  AGENCIES ||--o{ CLIENT_ORGANIZATIONS : manages
  CLIENT_ORGANIZATIONS ||--o{ CLIENT_MEMBERS : grants
  CLIENT_ORGANIZATIONS ||--o{ SEO_PROJECTS : owns
  SEO_PROJECTS ||--o{ SEO_SERVICES : defines
  SEO_PROJECTS ||--o{ SEO_LOCATIONS : targets
  SEO_PROJECTS ||--o{ SEO_KEYWORDS : tracks
  SEO_KEYWORDS ||--o{ ORGANIC_RANKING_SNAPSHOTS : records
  SEO_PROJECTS ||--o{ SEO_OPPORTUNITIES : scores
  SEO_OPPORTUNITIES ||--o{ SEO_ACTION_DRAFTS : prepares
  SEO_ACTION_DRAFTS ||--o{ SEO_TASKS : schedules
  SEO_OPPORTUNITIES ||--o{ SEO_EXECUTIONS : executes
  SEO_EXECUTIONS ||--o{ SEO_EXECUTION_OUTCOMES : measures
```

All tenant-owned rows carry `agency_id`; client and project scoped rows additionally carry `client_organization_id` and `project_id`. Composite foreign keys and RLS prevent a child row from pointing to a parent in another tenant.
