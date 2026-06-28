output "alb_dns_name" {
  description = "Public DNS name of the ALB — point web/api CNAMEs here."
  value       = module.alb.alb_dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone id (for Route53 alias records)."
  value       = module.alb.alb_zone_id
}

output "ecr_repository_urls" {
  description = "ECR repository URLs by app name."
  value       = module.ecr.repository_urls
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.ecs.cluster_name
}

output "ecs_service_names" {
  description = "ECS service names by app."
  value       = module.ecs.service_names
}

output "migrate_task_definition" {
  description = "Family of the one-off DB migration task (run before each rollout)."
  value       = module.ecs.migrate_task_definition_family
}

output "rds_endpoint" {
  description = "RDS endpoint (host:port)."
  value       = module.rds.endpoint
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint."
  value       = module.redis.primary_endpoint
}

output "database_url_secret_arn" {
  description = "Secrets Manager ARN holding the composed DATABASE_URL."
  value       = module.rds.database_url_secret_arn
}

output "redis_url_secret_arn" {
  description = "Secrets Manager ARN holding the composed REDIS_URL."
  value       = module.redis.redis_url_secret_arn
}

output "app_secret_arns" {
  description = "Map of application secret name → Secrets Manager ARN (populate external ones out-of-band)."
  value       = module.secrets.secret_arns
}

output "audit_logs_bucket" {
  description = "S3 bucket for durable audit-log archival."
  value       = module.s3.audit_logs_bucket_id
}

output "ses_dkim_tokens" {
  description = "DKIM CNAME tokens to publish if DNS is managed outside Route53."
  value       = module.ses.dkim_tokens
}

output "github_actions_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions to assume via OIDC (set as AWS_DEPLOY_ROLE_ARN)."
  value       = module.github_oidc.deploy_role_arn
}

output "alarm_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms."
  value       = module.observability.sns_topic_arn
}
