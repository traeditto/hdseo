output "workload_identity_provider" {value=google_iam_workload_identity_pool_provider.vercel.name}
output "vercel_service_account" {value=google_service_account.vercel_control.email}
output "connector_kms_key" {value=google_kms_crypto_key.connector.id}
output "worker_urls" {value={for key,service in google_cloud_run_v2_service.worker:key=>service.uri}}
output "pubsub_topics" {value={for key,topic in google_pubsub_topic.main:key=>topic.id}}
output "secret_resource_ids" {value={for key,secret in google_secret_manager_secret.platform:key=>secret.id}}
