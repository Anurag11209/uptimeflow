variable "name_prefix" {
  description = "Prefix applied to all resource names (e.g. uptimeflow-prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region used for CloudWatch dashboard widgets."
  type        = string
}

variable "alarm_email" {
  description = "Email address for SNS alarm notifications. Empty string disables the subscription."
  type        = string
  default     = ""
}

variable "alb_arn_suffix" {
  description = "ARN suffix of the ALB for AWS/ApplicationELB metrics (LoadBalancer dimension)."
  type        = string
}

variable "api_tg_arn_suffix" {
  description = "ARN suffix of the API target group (TargetGroup dimension)."
  type        = string
}

variable "web_tg_arn_suffix" {
  description = "ARN suffix of the web target group (TargetGroup dimension)."
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name (ClusterName dimension for AWS/ECS metrics)."
  type        = string
}

variable "ecs_service_names" {
  description = "List of ECS service names to monitor, e.g. [\"uptimeflow-prod-api\", \"uptimeflow-prod-web\", \"uptimeflow-prod-worker\"]."
  type        = list(string)
}

variable "rds_instance_id" {
  description = "RDS DBInstanceIdentifier for AWS/RDS metrics."
  type        = string
}

variable "redis_cluster_id" {
  description = "ElastiCache replication group id (ReplicationGroupId dimension for AWS/ElastiCache metrics)."
  type        = string
}
