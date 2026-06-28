output "endpoint" {
  description = "Connection endpoint in host:port form."
  value       = aws_db_instance.this.endpoint
}

output "db_instance_id" {
  description = "RDS instance identifier/id."
  value       = aws_db_instance.this.id
}

output "database_url_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the DATABASE_URL connection string."
  value       = aws_secretsmanager_secret.database_url.arn
}
