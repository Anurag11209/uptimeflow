variable "name_prefix" {
  description = "Prefix applied to all bucket names created by this module."
  type        = string
}

variable "enable_versioning" {
  description = "Whether to enable versioning on the audit logs bucket."
  type        = bool
}

variable "force_destroy" {
  description = "Whether to allow Terraform to destroy non-empty buckets."
  type        = bool
}

variable "noncurrent_expiration_days" {
  description = "Number of days after which noncurrent versions in the audit logs bucket are expired."
  type        = number
}

variable "alb_access_logs_enabled" {
  description = "Whether to attach the ELB log-delivery bucket policy to the ALB access logs bucket."
  type        = bool
}
