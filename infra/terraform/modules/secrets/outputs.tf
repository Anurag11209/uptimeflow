# Map of logical secret key → Secrets Manager ARN. ECS task definitions inject
# these by ARN; the execution role is granted GetSecretValue on exactly these.
output "secret_arns" {
  value = merge(
    {
      better_auth_secret = aws_secretsmanager_secret.better_auth_secret.arn
      metrics_token      = aws_secretsmanager_secret.metrics_token.arn
    },
    { for k, s in aws_secretsmanager_secret.external : k => s.arn }
  )
}
