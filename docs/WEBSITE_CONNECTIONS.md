# HD SEO website connections

HD SEO does not require a client website to use GitHub. Agency users with integration-management permission can open **Agency → Websites**, select a client, and choose the connection that matches the client’s actual publishing workflow.

## Supported onboarding paths

| Path | Client provides | What HD SEO verifies | Operating mode |
| --- | --- | --- | --- |
| WordPress | Public HTTPS URL, WordPress username, Application Password | REST API identity and editing capability | Direct WordPress API access |
| Shopify | Permanent `myshopify.com` domain and Admin API access token | Shop identity through the Admin GraphQL API | Direct Shopify API access |
| Webflow | Public HTTPS URL, site ID, and API token | The token can access the selected Webflow site | Direct Webflow API access |
| GitHub + Vercel | GitHub App installation and authorized repository | Installation ownership and repository authorization | Repository deployment pipeline |
| Another platform | Public HTTPS URL and platform name | The domain resolves only to public internet addresses | Reviewable CMS/developer handoff |
| Monitoring only | Public HTTPS URL | The domain resolves only to public internet addresses | Read-only analysis and monitoring |
| HD SEO managed migration | Public HTTPS URL and onboarding notes | The domain resolves only to public internet addresses | Pending managed onboarding review |

## WordPress setup

1. Sign in to the client WordPress dashboard with the user HD SEO should operate as.
2. Open **Users → Profile → Application Passwords**.
3. Create a password named **HD SEO**.
4. Copy the generated password once and enter it on the HD SEO connection form with the WordPress username.
5. HD SEO verifies the user through `/wp-json/wp/v2/users/me?context=edit`. The normal WordPress account password is never requested.

## Shopify setup

Use the store’s permanent `store-name.myshopify.com` domain and an Admin API token belonging to the client’s authorized Shopify app. The token must have the content permissions needed for the work the agency intends to approve. HD SEO validates the token against Shopify’s versioned Admin GraphQL API before saving it.

## Webflow setup

Provide the live HTTPS URL, the Webflow site ID, and a site-scoped or OAuth access token. HD SEO calls the Webflow Data API and confirms the returned site ID exactly matches the requested site.

## Credential and network security

- Direct-provider credentials are verified server-side and encrypted with AES-256-GCM before being written to `cms_connections`.
- The agency snapshot never selects or returns `encrypted_secret_reference`.
- Disconnecting a website removes the encrypted credential reference and preserves the audit history.
- Connection requests require HTTPS, reject credentials embedded in URLs, reject non-standard ports, resolve DNS server-side, and reject local, private, loopback, link-local, and reserved destinations.
- Every connect and disconnect operation is tenant-scoped, permission-checked, rate-limited, and written to the audit trail.

## Required production configuration

`APP_ENCRYPTION_KEY` must be configured in the production runtime before direct provider credentials can be stored. Existing GitHub App, Supabase service-role, search-data provider, and Vercel variables remain required for their corresponding workflows.
