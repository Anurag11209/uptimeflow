output "primary_endpoint" {
  description = "Primary endpoint address of the Redis replication group."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "replication_group_id" {
  description = "ID of the Redis replication group."
  value       = aws_elasticache_replication_group.this.replication_group_id
}

output "redis_url_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the composed REDIS_URL."
  value       = aws_secretsmanager_secret.redis_url.arn
}
