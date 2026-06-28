output "audit_logs_bucket_id" {
  description = "The ID (name) of the audit logs bucket."
  value       = aws_s3_bucket.audit_logs.id
}

output "audit_logs_bucket_arn" {
  description = "The ARN of the audit logs bucket."
  value       = aws_s3_bucket.audit_logs.arn
}

output "alb_logs_bucket_id" {
  description = "The ID (name) of the ALB access logs bucket."
  value       = aws_s3_bucket.alb_logs.id
}

output "alb_logs_bucket_arn" {
  description = "The ARN of the ALB access logs bucket."
  value       = aws_s3_bucket.alb_logs.arn
}
