variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "api_security_group_id" {
  type = string
}

variable "web_security_group_id" {
  type = string
}

variable "worker_security_group_id" {
  type = string
}

variable "enable_container_insights" {
  type = bool
}

variable "log_retention_days" {
  type = number
}

# ── Images ────────────────────────────────────────────────────────────
variable "repository_urls" {
  description = "Map of app name (api/web/worker) → ECR repository URL."
  type        = map(string)
}

variable "image_tag" {
  type = string
}

# ── ALB target groups ─────────────────────────────────────────────────
variable "api_target_group_arn" {
  type = string
}

variable "web_target_group_arn" {
  type = string
}

# ── Secrets (Secrets Manager ARNs) ────────────────────────────────────
variable "database_url_secret_arn" {
  type = string
}

variable "redis_url_secret_arn" {
  type = string
}

variable "app_secret_arns" {
  description = "Map of logical secret key → Secrets Manager ARN."
  type        = map(string)
}

# ── Non-secret runtime config ─────────────────────────────────────────
variable "better_auth_url" {
  type = string
}

variable "web_url" {
  type = string
}

variable "cors_origins" {
  type = string
}

variable "log_level" {
  type = string
}

variable "email_from" {
  type = string
}

variable "ses_region" {
  type = string
}

variable "ses_identity_arn" {
  type = string
}

variable "audit_logs_bucket" {
  type = string
}

variable "audit_logs_arn" {
  type = string
}

# ── Ports + sizing ────────────────────────────────────────────────────
variable "api_port" {
  type = number
}
variable "web_port" {
  type = number
}
variable "worker_concurrency" {
  type = number
}

variable "api_cpu" { type = number }
variable "api_memory" { type = number }
variable "api_desired_count" { type = number }
variable "api_min_count" { type = number }
variable "api_max_count" { type = number }

variable "web_cpu" { type = number }
variable "web_memory" { type = number }
variable "web_desired_count" { type = number }
variable "web_min_count" { type = number }
variable "web_max_count" { type = number }

variable "worker_cpu" { type = number }
variable "worker_memory" { type = number }
variable "worker_desired_count" { type = number }
variable "worker_min_count" { type = number }
variable "worker_max_count" { type = number }
