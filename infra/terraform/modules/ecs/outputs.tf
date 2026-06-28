output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_names" {
  description = "Map of app → ECS service name."
  value = {
    api    = aws_ecs_service.api.name
    web    = aws_ecs_service.web.name
    worker = aws_ecs_service.worker.name
  }
}

output "service_names_list" {
  value = [
    aws_ecs_service.api.name,
    aws_ecs_service.web.name,
    aws_ecs_service.worker.name,
  ]
}

output "service_arns_list" {
  value = [
    aws_ecs_service.api.id,
    aws_ecs_service.web.id,
    aws_ecs_service.worker.id,
  ]
}

# Roles CI must be able to iam:PassRole when registering new task definitions.
output "passable_role_arns" {
  value = [
    aws_iam_role.execution.arn,
    aws_iam_role.api_task.arn,
    aws_iam_role.web_task.arn,
    aws_iam_role.worker_task.arn,
  ]
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "migrate_task_definition_family" {
  value = aws_ecs_task_definition.migrate.family
}
