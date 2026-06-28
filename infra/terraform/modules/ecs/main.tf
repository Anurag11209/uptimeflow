# ECS Fargate cluster + per-service CloudWatch log groups. Task definitions,
# services, IAM, and autoscaling live in the sibling files of this module.

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    base              = 1
    weight            = 1
  }
}

# One log group per workload (app log groups are owned here, not by observability).
resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(["api", "web", "worker", "migrate"])
  name              = "/ecs/${var.name_prefix}/${each.key}"
  retention_in_days = var.log_retention_days
}

locals {
  images = {
    api    = "${var.repository_urls["api"]}:${var.image_tag}"
    web    = "${var.repository_urls["web"]}:${var.image_tag}"
    worker = "${var.repository_urls["worker"]}:${var.image_tag}"
  }

  # Shared awslogs config builder.
  log_config = {
    for k in ["api", "web", "worker", "migrate"] : k => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this[k].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = k
      }
    }
  }

  # Secrets shared by api + worker (DB + Redis URLs).
  data_secrets = [
    { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
    { name = "REDIS_URL", valueFrom = var.redis_url_secret_arn },
  ]

  # Full app-secret set for the API (auth, billing, OAuth).
  api_secrets = concat(local.data_secrets, [
    { name = "BETTER_AUTH_SECRET", valueFrom = var.app_secret_arns["better_auth_secret"] },
    { name = "METRICS_TOKEN", valueFrom = var.app_secret_arns["metrics_token"] },
    { name = "STRIPE_SECRET_KEY", valueFrom = var.app_secret_arns["stripe_secret_key"] },
    { name = "STRIPE_WEBHOOK_SECRET", valueFrom = var.app_secret_arns["stripe_webhook_secret"] },
    { name = "STRIPE_PUBLISHABLE_KEY", valueFrom = var.app_secret_arns["stripe_publishable_key"] },
    { name = "GITHUB_CLIENT_ID", valueFrom = var.app_secret_arns["github_client_id"] },
    { name = "GITHUB_CLIENT_SECRET", valueFrom = var.app_secret_arns["github_client_secret"] },
    { name = "GOOGLE_CLIENT_ID", valueFrom = var.app_secret_arns["google_client_id"] },
    { name = "GOOGLE_CLIENT_SECRET", valueFrom = var.app_secret_arns["google_client_secret"] },
  ])

  # Every secret ARN the execution role must be allowed to read.
  all_secret_arns = concat(
    [var.database_url_secret_arn, var.redis_url_secret_arn],
    values(var.app_secret_arns),
  )
}
