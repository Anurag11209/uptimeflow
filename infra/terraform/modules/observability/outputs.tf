output "sns_topic_arn" {
  description = "ARN of the SNS topic that receives alarm notifications."
  value       = aws_sns_topic.alarms.arn
}

output "dashboard_name" {
  description = "Name of the CloudWatch dashboard."
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}
