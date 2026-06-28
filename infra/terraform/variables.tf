# ── Core ──────────────────────────────────────────────────────────────
variable "project" {
  description = "Project name; used as the resource name prefix."
  type        = string
  default     = "uptimeflow"
}

variable "environment" {
  description = "Deployment environment (dev | staging | production)."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be one of: dev, staging, production."
  }
}

variable "aws_region" {
  description = "AWS region for all resources (SES domain is verified here too)."
  type        = string
  default     = "us-east-1"
}

# ── Networking ────────────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to span (2 minimum for HA)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "single_nat_gateway" {
  description = "Use one shared NAT Gateway (cheap, dev) vs one per AZ (HA, prod)."
  type        = bool
  default     = true
}

# ── DNS / TLS ─────────────────────────────────────────────────────────
variable "domain_name" {
  description = "Apex domain (e.g. uptimeflow.in); used for SES and as the ACM base."
  type        = string
  default     = "uptimeflow.in"
}

variable "web_domain" {
  description = "Public hostname for the web app (e.g. app.uptimeflow.in)."
  type        = string
  default     = "app.uptimeflow.in"
}

variable "api_domain" {
  description = "Public hostname for the API (e.g. api.uptimeflow.in)."
  type        = string
  default     = "api.uptimeflow.in"
}

variable "route53_zone_id" {
  description = "Route53 hosted zone id for DNS validation + records. Empty to manage DNS elsewhere (e.g. Cloudflare)."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ARN of an existing ACM certificate covering web/api domains. Required for the HTTPS listener."
  type        = string
  default     = ""
}

# ── Application ports ─────────────────────────────────────────────────
variable "api_port" {
  description = "Container port the API listens on."
  type        = number
  default     = 4000
}

variable "web_port" {
  description = "Container port the web app listens on."
  type        = number
  default     = 3000
}

# ── ECR ───────────────────────────────────────────────────────────────
variable "ecr_repositories" {
  description = "Container images to host (one ECR repo each)."
  type        = list(string)
  default     = ["api", "worker", "web"]
}

variable "ecr_max_image_count" {
  description = "Number of tagged images to retain per repository."
  type        = number
  default     = 20
}

variable "image_tag" {
  description = "Image tag ECS task definitions pull. CI rolls new tags via update-service."
  type        = string
  default     = "latest"
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────
variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage" {
  description = "Initial RDS storage (GiB)."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling (GiB)."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Run RDS Multi-AZ (HA failover)."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Automated backup retention window (days). >0 enables PITR."
  type        = number
  default     = 7
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "uptimeflow"
}

variable "db_username" {
  description = "Master username."
  type        = string
  default     = "uptimeflow"
}

variable "db_monitoring_interval" {
  description = "Enhanced Monitoring granularity in seconds (0 disables)."
  type        = number
  default     = 60
}

variable "db_performance_insights" {
  description = "Enable RDS Performance Insights."
  type        = bool
  default     = true
}

# ── ElastiCache Redis ─────────────────────────────────────────────────
variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "redis_num_cache_clusters" {
  description = "Number of nodes (>=2 enables automatic failover)."
  type        = number
  default     = 1
}

variable "redis_multi_az" {
  description = "Enable Multi-AZ with automatic failover (needs num_cache_clusters >= 2)."
  type        = bool
  default     = false
}

variable "redis_engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

# ── S3 ────────────────────────────────────────────────────────────────
variable "s3_versioning" {
  description = "Enable versioning on data buckets."
  type        = bool
  default     = true
}

variable "s3_force_destroy" {
  description = "Allow Terraform to delete non-empty buckets (dev convenience)."
  type        = bool
  default     = false
}

variable "s3_noncurrent_expiration_days" {
  description = "Expire noncurrent object versions after N days."
  type        = number
  default     = 90
}

variable "alb_access_logs_enabled" {
  description = "Ship ALB access logs to the logs bucket."
  type        = bool
  default     = true
}

# ── Email (SES) ───────────────────────────────────────────────────────
variable "email_from" {
  description = "Default From address (must be within the verified SES domain)."
  type        = string
  default     = "alerts@uptimeflow.in"
}

# ── ECS service sizing ────────────────────────────────────────────────
variable "api_cpu" {
  type    = number
  default = 512
}
variable "api_memory" {
  type    = number
  default = 1024
}
variable "api_desired_count" {
  type    = number
  default = 2
}
variable "api_min_count" {
  type    = number
  default = 2
}
variable "api_max_count" {
  type    = number
  default = 6
}

variable "web_cpu" {
  type    = number
  default = 256
}
variable "web_memory" {
  type    = number
  default = 512
}
variable "web_desired_count" {
  type    = number
  default = 2
}
variable "web_min_count" {
  type    = number
  default = 2
}
variable "web_max_count" {
  type    = number
  default = 4
}

variable "worker_cpu" {
  type    = number
  default = 512
}
variable "worker_memory" {
  type    = number
  default = 1024
}
variable "worker_desired_count" {
  type    = number
  default = 1
}
variable "worker_min_count" {
  type    = number
  default = 1
}
variable "worker_max_count" {
  type    = number
  default = 4
}

variable "worker_concurrency" {
  description = "BullMQ worker concurrency per task."
  type        = number
  default     = 10
}

# ── Application config (non-secret) ───────────────────────────────────
variable "cors_origins" {
  description = "Comma-separated extra CORS origins (web_url is always trusted)."
  type        = string
  default     = ""
}

variable "log_level" {
  description = "Application log level."
  type        = string
  default     = "info"
}

# ── Observability ─────────────────────────────────────────────────────
variable "enable_container_insights" {
  description = "Enable ECS Container Insights."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention for app logs (days)."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Email subscribed to the CloudWatch alarm SNS topic. Empty to skip subscription."
  type        = string
  default     = ""
}

# ── Safety ────────────────────────────────────────────────────────────
variable "enable_deletion_protection" {
  description = "Protect RDS and the ALB from accidental deletion (enable in prod)."
  type        = bool
  default     = false
}

# ── CI/CD (GitHub OIDC) ───────────────────────────────────────────────
variable "github_owner" {
  description = "GitHub org/user that owns the repo (OIDC trust)."
  type        = string
  default     = "Anurag11209"
}

variable "github_repo" {
  description = "GitHub repository name (OIDC trust)."
  type        = string
  default     = "uptimeflow"
}
