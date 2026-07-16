# HD SEO autonomous discovery and workflow orchestration

HD SEO campaign jobs now begin with evidence discovery. Customers provide a
domain, market, and budget; they do not need to provide seed keywords.

## Discovery order

1. Reuse current active keyword evidence when it already exists.
2. Derive keyword candidates from stored Google Search Console rows.
3. If explicitly authorized, run bounded DataForSEO domain and ranked-keyword discovery.
4. Pause in `awaiting_data_connection` when neither source is available. The user is asked to connect evidence, not type keywords.

Search Console impressions remain labeled as first-party visibility and are not
represented as third-party search volume.

## Campaign request

`POST /api/campaigns/generate` accepts these discovery fields:

| Field | Default | Purpose |
|---|---:|---|
| `monthlyBudget` | `1500` | Budget used for directional value and effort prioritization |
| `targetMarket` | `United States` | Provider market for domain discovery |
| `discoveryLimit` | `50` | Maximum provider records, capped again by server configuration |
| `authorizeDataSpend` | `false` | Explicitly authorizes the exact hashed DataForSEO scope |

Provider authorization is one-time, expires after 30 minutes, is bound to the
requesting user and exact scope hash, and remains subject to the agency-wide
daily cost limit.

## Conditional workflow plan

The snapshot stage classifies the project from configured services, locations,
page URLs, headings, schema types, language, and market. It then creates a
versioned workflow plan for technical, content, schema, sitemap, performance,
images, GEO, Search Console, local, maps, e-commerce, hreflang, clustering, and
drift work.

Every workflow reports one of:

- `ready`
- `setup_required`
- `not_applicable`

Missing optional providers do not fabricate data and do not block unrelated
workflows.

## Deployment drift gate

Every deployment is compared with the most recent healthy deployment in the
same Vercel project and environment. Removing or changing canonicals, adding
`noindex`, removing the title or H1, or removing all existing schema types fails
the required drift gate. Title, description, H1, partial schema, and material
performance changes are recorded as warnings.

Apply `supabase/migrations/0014_autonomous_discovery_and_drift.sql` before
deploying this application version. The SEO campaign worker is scheduled every
five minutes so paid authorizations are consumed while still current.
