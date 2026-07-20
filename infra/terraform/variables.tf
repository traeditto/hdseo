variable "project_id" {type=string}
variable "project_number" {type=string}
variable "region" {type=string default="us-east1"}
variable "environment" {type=string validation {condition=contains(["staging","production"],var.environment) error_message="environment must be staging or production"}}
variable "vercel_oidc_issuer" {type=string default="https://oidc.vercel.com"}
variable "vercel_oidc_audience" {type=string}
variable "vercel_project_id" {type=string}
variable "worker_images" {
  type=map(string)
  validation {
    condition=alltrue([for key in ["scheduler","webhook","evidence","crawler","agent","deployment","notification","reporting"]:contains(keys(var.worker_images),key)&&can(regex("@sha256:[0-9a-f]{64}$",var.worker_images[key]))])
    error_message="Every worker image must be supplied by an immutable sha256 digest."
  }
}
variable "supabase_egress_cidr" {type=list(string) default=[]}
variable "lock_audit_retention" {type=bool default=false}
