###############################################################################
# SNS topic + optional email subscription
###############################################################################

resource "aws_sns_topic" "alarms" {
  name = "${var.name_prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count = var.alarm_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]

  # Target groups keyed for the unhealthy-host alarms.
  target_groups = {
    api = var.api_tg_arn_suffix
    web = var.web_tg_arn_suffix
  }
}

###############################################################################
# ALB alarms
###############################################################################

resource "aws_cloudwatch_metric_alarm" "alb_elb_5xx" {
  alarm_name          = "${var.name_prefix}-alb-elb-5xx"
  alarm_description   = "ALB-generated 5XX responses exceed threshold."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  period              = 300
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "alb_target_5xx" {
  alarm_name          = "${var.name_prefix}-alb-target-5xx"
  alarm_description   = "Target-generated 5XX responses exceed threshold."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  period              = 300
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_hosts" {
  for_each = local.target_groups

  alarm_name          = "${var.name_prefix}-alb-${each.key}-unhealthy-hosts"
  alarm_description   = "Unhealthy hosts detected in the ${each.key} target group."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  dimensions = {
    TargetGroup  = each.value
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "alb_target_response_time" {
  alarm_name          = "${var.name_prefix}-alb-target-response-time-p95"
  alarm_description   = "ALB target response time p95 exceeds 2 seconds."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 2
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

###############################################################################
# ECS per-service alarms
###############################################################################

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  for_each = toset(var.ecs_service_names)

  alarm_name          = "${each.value}-cpu-high"
  alarm_description   = "ECS service ${each.value} CPU utilization above 85%."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  for_each = toset(var.ecs_service_names)

  alarm_name          = "${each.value}-memory-high"
  alarm_description   = "ECS service ${each.value} memory utilization above 85%."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

###############################################################################
# RDS alarms
###############################################################################

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU utilization above 80%."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${var.name_prefix}-rds-free-storage-low"
  alarm_description   = "RDS free storage space below 5GB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  comparison_operator = "LessThanThreshold"
  threshold           = 5000000000
  period              = 300
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${var.name_prefix}-rds-connections-high"
  alarm_description   = "RDS database connections above 80."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_freeable_memory" {
  alarm_name          = "${var.name_prefix}-rds-freeable-memory-low"
  alarm_description   = "RDS freeable memory below 256MB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  statistic           = "Average"
  comparison_operator = "LessThanThreshold"
  threshold           = 268435456
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

###############################################################################
# ElastiCache Redis alarms
###############################################################################

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${var.name_prefix}-redis-cpu-high"
  alarm_description   = "Redis CPU utilization above 75%."
  namespace           = "AWS/ElastiCache"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 75
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = var.redis_cluster_id
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${var.name_prefix}-redis-memory-high"
  alarm_description   = "Redis database memory usage above 80%."
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = var.redis_cluster_id
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "redis_evictions" {
  alarm_name          = "${var.name_prefix}-redis-evictions"
  alarm_description   = "Redis is evicting keys."
  namespace           = "AWS/ElastiCache"
  metric_name         = "Evictions"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 300
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = var.redis_cluster_id
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

###############################################################################
# Dashboard
###############################################################################

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = var.name_prefix

  dashboard_body = jsonencode({
    widgets = concat(
      [
        {
          type   = "metric"
          x      = 0
          y      = 0
          width  = 12
          height = 6
          properties = {
            title   = "ALB request count and 5XX"
            region  = var.aws_region
            view    = "timeSeries"
            stacked = false
            period  = 300
            stat    = "Sum"
            metrics = [
              ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix],
              ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", "LoadBalancer", var.alb_arn_suffix],
              ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix],
            ]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 0
          width  = 12
          height = 6
          properties = {
            title  = "ALB target response time (p95)"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            stat   = "p95"
            metrics = [
              ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix],
            ]
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 6
          width  = 12
          height = 6
          properties = {
            title  = "ECS CPU utilization per service"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            stat   = "Average"
            metrics = [
              for svc in var.ecs_service_names :
              ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", svc]
            ]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 6
          width  = 12
          height = 6
          properties = {
            title  = "ECS memory utilization per service"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            stat   = "Average"
            metrics = [
              for svc in var.ecs_service_names :
              ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", svc]
            ]
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 12
          width  = 12
          height = 6
          properties = {
            title  = "RDS CPU and connections"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            stat   = "Average"
            metrics = [
              ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_id],
              ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_instance_id],
            ]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 12
          width  = 12
          height = 6
          properties = {
            title  = "Redis CPU and memory"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            stat   = "Average"
            metrics = [
              ["AWS/ElastiCache", "CPUUtilization", "ReplicationGroupId", var.redis_cluster_id],
              ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "ReplicationGroupId", var.redis_cluster_id],
            ]
          }
        },
      ]
    )
  })
}
