output "deploy_role_arn" {
  description = "ARN of the IAM role GitHub Actions assumes to deploy."
  value       = aws_iam_role.deploy.arn
}
