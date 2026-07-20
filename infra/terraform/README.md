# HD SEO production control plane

This Terraform stack creates the private Google Cloud worker plane for one environment: authenticated Pub/Sub push queues with dead-letter topics, private Cloud Run workers, workload-specific service accounts, KMS keys, encrypted evidence and retention-locked audit buckets, BigQuery history, Cloud Scheduler, and Vercel OIDC federation.

Use separate Google Cloud projects and separate Terraform state buckets for staging and production. Container inputs must be immutable image digests. Apply production through a protected GitHub environment after an approved plan. Leave `lock_audit_retention=false` during initial validation; after the audit export and restore drill pass, approve a dedicated plan that changes it to `true`. That lock is intentionally irreversible.

The crawler identity receives no KMS or secret permissions. Provider credentials are decrypted only by the connector-capable workers. Vercel is granted connector-key encryption and private-service invocation only; it is not granted database administration.
