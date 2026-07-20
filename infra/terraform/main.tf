locals {
  prefix="hdseo-${var.environment}"
  apis=toset(["run.googleapis.com","pubsub.googleapis.com","cloudkms.googleapis.com","secretmanager.googleapis.com","iamcredentials.googleapis.com","sts.googleapis.com","bigquery.googleapis.com","storage.googleapis.com","cloudscheduler.googleapis.com","artifactregistry.googleapis.com","logging.googleapis.com","monitoring.googleapis.com"])
  workers=toset(["scheduler","webhook","evidence","crawler","agent","deployment","notification","reporting"])
  topics=toset(["webhooks","evidence-sync","crawls","agent-work","deployments","notifications","reporting"])
  worker_topic={webhook="webhooks",evidence="evidence-sync",crawler="crawls",agent="agent-work",deployment="deployments",notification="notifications",reporting="reporting"}
  platform_secrets=toset(["supabase-worker-url","supabase-worker-service-role","github-app-private-key","github-webhook-secret","stripe-restricted-key","stripe-webhook-secret","google-oauth-client-secret","openai-api-key","resend-api-key","hubspot-service-key"])
  worker_secret_access={
    scheduler=toset(["supabase-worker-url","supabase-worker-service-role"])
    webhook=toset(["supabase-worker-url","supabase-worker-service-role","github-webhook-secret","stripe-webhook-secret"])
    evidence=toset(["supabase-worker-url","supabase-worker-service-role","google-oauth-client-secret","hubspot-service-key"])
    agent=toset(["supabase-worker-url","supabase-worker-service-role","openai-api-key"])
    deployment=toset(["supabase-worker-url","supabase-worker-service-role","github-app-private-key"])
    notification=toset(["supabase-worker-url","supabase-worker-service-role","resend-api-key"])
    reporting=toset(["supabase-worker-url","supabase-worker-service-role"])
  }
  worker_secret_pairs=merge([for worker,secrets in local.worker_secret_access:{for secret in secrets:"${worker}:${secret}"=>{worker=worker,secret=secret}}]...)
}

resource "google_project_service" "required" {for_each=local.apis service=each.value disable_on_destroy=false}
data "google_project" "current" {project_id=var.project_id}
resource "google_project_service_identity" "pubsub" {provider=google-beta project=var.project_id service="pubsub.googleapis.com" depends_on=[google_project_service.required]}

resource "google_service_account" "worker" {for_each=local.workers account_id=substr("${local.prefix}-${each.key}",0,30) display_name="HD SEO ${each.key} (${var.environment})" depends_on=[google_project_service.required]}
resource "google_service_account" "pubsub_push" {account_id=substr("${local.prefix}-pubsub-push",0,30) display_name="HD SEO authenticated Pub/Sub push"}
resource "google_service_account" "vercel_control" {account_id=substr("${local.prefix}-vercel",0,30) display_name="HD SEO Vercel control plane"}

resource "google_pubsub_topic" "main" {for_each=local.topics name="${local.prefix}-${each.key}" message_retention_duration="86400s"}
resource "google_pubsub_topic" "dead_letter" {for_each=local.topics name="${local.prefix}-${each.key}-dead-letter" message_retention_duration="1209600s"}

resource "google_cloud_run_v2_service" "worker" {
  for_each=local.workers name="${local.prefix}-${each.key}" location=var.region ingress="INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection=var.environment=="production"
  template {
    service_account=google_service_account.worker[each.key].email timeout="900s" max_instance_request_concurrency=each.key=="crawler"?1:20
    scaling {min_instance_count=var.environment=="production"&&each.key!="crawler"?1:0 max_instance_count=each.key=="crawler"?200:100}
    containers {image=var.worker_images[each.key] resources {limits={cpu=each.key=="crawler"?"2":"1",memory=each.key=="crawler"?"2Gi":"1Gi"}} env {name="HDSEO_ENVIRONMENT" value=var.environment}}
  }
  depends_on=[google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "pubsub_invoker" {
  for_each=local.worker_topic project=var.project_id location=var.region name=google_cloud_run_v2_service.worker[each.key].name
  role="roles/run.invoker" member="serviceAccount:${google_service_account.pubsub_push.email}"
}
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {project=var.project_id location=var.region name=google_cloud_run_v2_service.worker["scheduler"].name role="roles/run.invoker" member="serviceAccount:${google_service_account.worker["scheduler"].email}"}
resource "google_service_account_iam_member" "pubsub_token_creator" {service_account_id=google_service_account.pubsub_push.name role="roles/iam.serviceAccountTokenCreator" member="serviceAccount:${google_project_service_identity.pubsub.email}"}
resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {for_each=local.topics topic=google_pubsub_topic.dead_letter[each.key].name role="roles/pubsub.publisher" member="serviceAccount:${google_project_service_identity.pubsub.email}"}
resource "google_pubsub_subscription_iam_member" "dead_letter_subscriber" {for_each=local.worker_topic subscription=google_pubsub_subscription.push[each.key].name role="roles/pubsub.subscriber" member="serviceAccount:${google_project_service_identity.pubsub.email}"}
resource "google_pubsub_topic_iam_member" "scheduler_publisher" {for_each=local.topics topic=google_pubsub_topic.main[each.key].name role="roles/pubsub.publisher" member="serviceAccount:${google_service_account.worker["scheduler"].email}"}

resource "google_pubsub_subscription" "push" {
  for_each=local.worker_topic name="${local.prefix}-${each.value}-push" topic=google_pubsub_topic.main[each.value].id ack_deadline_seconds=60
  message_retention_duration="604800s" retain_acked_messages=false enable_exactly_once_delivery=true
  retry_policy {minimum_backoff="10s" maximum_backoff="600s"}
  dead_letter_policy {dead_letter_topic=google_pubsub_topic.dead_letter[each.value].id max_delivery_attempts=10}
  push_config {push_endpoint="${google_cloud_run_v2_service.worker[each.key].uri}/internal/pubsub" oidc_token {service_account_email=google_service_account.pubsub_push.email audience=google_cloud_run_v2_service.worker[each.key].uri}}
}

resource "google_kms_key_ring" "hdseo" {name=local.prefix location=var.region}
resource "google_kms_crypto_key" "connector" {name="connector-secrets" key_ring=google_kms_key_ring.hdseo.id rotation_period="7776000s" lifecycle {prevent_destroy=true}}
resource "google_kms_crypto_key" "integration_state" {name="integration-state" key_ring=google_kms_key_ring.hdseo.id rotation_period="7776000s" lifecycle {prevent_destroy=true}}
resource "google_kms_crypto_key" "audit" {name="audit-manifests" key_ring=google_kms_key_ring.hdseo.id rotation_period="7776000s" lifecycle {prevent_destroy=true}}

resource "google_kms_crypto_key_iam_member" "connector_workers" {for_each=toset(["webhook","evidence","agent","deployment"]) crypto_key_id=google_kms_crypto_key.connector.id role="roles/cloudkms.cryptoKeyEncrypterDecrypter" member="serviceAccount:${google_service_account.worker[each.key].email}"}
resource "google_kms_crypto_key_iam_member" "vercel_encrypt" {crypto_key_id=google_kms_crypto_key.connector.id role="roles/cloudkms.cryptoKeyEncrypter" member="serviceAccount:${google_service_account.vercel_control.email}"}

resource "google_secret_manager_secret" "platform" {
  for_each=local.platform_secrets secret_id="${local.prefix}-${each.key}"
  replication {auto {}}
  depends_on=[google_project_service.required]
}
resource "google_secret_manager_secret_iam_member" "connector_workers" {
  for_each=local.worker_secret_pairs
  secret_id=google_secret_manager_secret.platform[each.value.secret].id role="roles/secretmanager.secretAccessor"
  member="serviceAccount:${google_service_account.worker[each.value.worker].email}"
}

resource "google_storage_bucket" "raw_evidence" {name="${local.prefix}-raw-evidence-${var.project_number}" location=var.region uniform_bucket_level_access=true public_access_prevention="enforced" force_destroy=false versioning {enabled=true} lifecycle_rule {condition {age=30} action {type="Delete"}}}
resource "google_storage_bucket" "audit" {name="${local.prefix}-audit-${var.project_number}" location=var.region uniform_bucket_level_access=true public_access_prevention="enforced" force_destroy=false versioning {enabled=true} retention_policy {retention_period=220752000 is_locked=var.lock_audit_retention}}

resource "google_bigquery_dataset" "history" {dataset_id=replace("${local.prefix}_history","-","_") location=var.region delete_contents_on_destroy=false default_table_expiration_ms=null}
resource "google_bigquery_table" "model_cost_events" {dataset_id=google_bigquery_dataset.history.dataset_id table_id="model_cost_events" deletion_protection=var.environment=="production" time_partitioning {type="MONTH" field="occurred_at"} clustering=["agency_id","project_id","model"] schema=jsonencode([{name="occurred_at",type="TIMESTAMP",mode="REQUIRED"},{name="agency_id",type="STRING",mode="REQUIRED"},{name="project_id",type="STRING",mode="NULLABLE"},{name="model",type="STRING",mode="REQUIRED"},{name="cost_usd",type="NUMERIC",mode="REQUIRED"},{name="trace_id",type="STRING",mode="NULLABLE"}])}

resource "google_iam_workload_identity_pool" "vercel" {provider=google-beta workload_identity_pool_id="${local.prefix}-vercel" display_name="Vercel ${var.environment}"}
resource "google_iam_workload_identity_pool_provider" "vercel" {
  provider=google-beta workload_identity_pool_id=google_iam_workload_identity_pool.vercel.workload_identity_pool_id workload_identity_pool_provider_id="vercel"
  oidc {issuer_uri=var.vercel_oidc_issuer allowed_audiences=[var.vercel_oidc_audience]}
  attribute_mapping={"google.subject"="assertion.sub","attribute.project_id"="assertion.project_id","attribute.environment"="assertion.environment"}
  attribute_condition="attribute.project_id == '${var.vercel_project_id}' && attribute.environment == '${var.environment}'"
}
resource "google_service_account_iam_member" "vercel_workload_user" {service_account_id=google_service_account.vercel_control.name role="roles/iam.workloadIdentityUser" member="principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.vercel.name}/attribute.project_id/${var.vercel_project_id}"}

resource "google_cloud_scheduler_job" "scheduler" {
  name="${local.prefix}-scheduler" region=var.region schedule="*/5 * * * *" time_zone="UTC" attempt_deadline="180s"
  retry_config {retry_count=3 min_backoff_duration="10s" max_backoff_duration="120s" max_retry_duration="300s"}
  http_target {http_method="POST" uri="${google_cloud_run_v2_service.worker["scheduler"].uri}/internal/schedule" oidc_token {service_account_email=google_service_account.worker["scheduler"].email audience=google_cloud_run_v2_service.worker["scheduler"].uri} headers={"Content-Type"="application/json"} body=base64encode(jsonencode({schemaVersion=2,environment=var.environment}))}
}
