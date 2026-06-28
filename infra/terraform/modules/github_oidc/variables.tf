variable "name_prefix" {
  description = "Prefix applied to created resource names."
  type        = string
}

variable "github_owner" {
  description = "GitHub organization or user that owns the repository."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name that is allowed to assume the deploy role."
  type        = string
}

variable "ecr_repository_arns" {
  description = "ARNs of the ECR repositories CI is allowed to push images to."
  type        = list(string)
}

variable "ecs_cluster_arn" {
  description = "ARN of the ECS cluster CI deploys to."
  type        = string
}

variable "ecs_service_arns" {
  description = "ARNs of the ECS services CI is allowed to update."
  type        = list(string)
}

variable "task_role_arns" {
  description = "Execution and task role ARNs that CI must be able to iam:PassRole when registering new task definitions."
  type        = list(string)
}
