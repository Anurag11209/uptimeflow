###############################################################################
# GitHub Actions OIDC identity provider
#
# Lets GitHub Actions exchange a short-lived OIDC token for AWS credentials,
# removing the need for long-lived IAM access keys in CI.
###############################################################################

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]

  lifecycle {
    # Modern AWS validates the GitHub OIDC root automatically; the thumbprint
    # list is supplied only for backwards compatibility and may rotate without
    # our involvement, so ignore it to avoid spurious drift.
    ignore_changes = [thumbprint_list]
  }
}

###############################################################################
# Trust policy: only this repo's workflows may assume the deploy role.
###############################################################################

data "aws_iam_policy_document" "assume_role" {
  statement {
    sid     = "GitHubActionsAssumeRole"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}/${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name_prefix}-gha-deploy"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

###############################################################################
# Least-privilege deploy permissions: push to ECR + deploy to ECS.
###############################################################################

data "aws_iam_policy_document" "deploy" {
  # ECR authorization token is account-wide and cannot be scoped to a resource.
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push and inspect images on the specific repositories only.
  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
    ]
    resources = var.ecr_repository_arns
  }

  # Update the targeted ECS services.
  statement {
    sid    = "EcsDeploy"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    resources = var.ecs_service_arns
  }

  # Task definition registration/inspection does not support resource-level
  # permissions, so it must be granted on "*".
  statement {
    sid    = "EcsTaskDefinitions"
    effect = "Allow"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  # Run/inspect tasks. RunTask cannot be reliably scoped to a resource, so it
  # is constrained to the target cluster via a condition.
  statement {
    sid    = "EcsRunTask"
    effect = "Allow"
    actions = [
      "ecs:RunTask",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
    ]
    resources = ["*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.ecs_cluster_arn]
    }
  }

  # Allow CI to hand the execution/task roles to ECS when registering task
  # definitions, but only to the ECS tasks service.
  statement {
    sid       = "PassTaskRoles"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = var.task_role_arns

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.name_prefix}-gha-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
