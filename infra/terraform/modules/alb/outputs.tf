output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "alb_arn_suffix" {
  description = "ARN suffix for CloudWatch AWS/ApplicationELB metrics."
  value       = aws_lb.this.arn_suffix
}

output "api_target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "api_tg_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}

output "web_tg_arn_suffix" {
  value = aws_lb_target_group.web.arn_suffix
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}
