output "repository_urls" {
  description = "Map of short repository name to repository URL."
  value       = { for k, repo in aws_ecr_repository.this : k => repo.repository_url }
}

output "repository_arns" {
  description = "Map of short repository name to repository ARN."
  value       = { for k, repo in aws_ecr_repository.this : k => repo.arn }
}
