# Application Auto Scaling — target-tracking on average CPU per service. ECS
# owns desired_count between min/max (services ignore_changes desired_count).

locals {
  scalable = {
    api    = { min = var.api_min_count, max = var.api_max_count, service = aws_ecs_service.api.name }
    web    = { min = var.web_min_count, max = var.web_max_count, service = aws_ecs_service.web.name }
    worker = { min = var.worker_min_count, max = var.worker_max_count, service = aws_ecs_service.worker.name }
  }
}

resource "aws_appautoscaling_target" "this" {
  for_each           = local.scalable
  max_capacity       = each.value.max
  min_capacity       = each.value.min
  resource_id        = "service/${aws_ecs_cluster.this.name}/${each.value.service}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.scalable
  name               = "${var.name_prefix}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.this[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.this[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
