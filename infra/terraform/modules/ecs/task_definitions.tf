# Fargate task definitions. Secrets are injected from Secrets Manager by ARN;
# only non-sensitive config is passed as plain environment.

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.api_cpu)
  memory                   = tostring(var.api_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "api"
    image     = local.images.api
    essential = true
    portMappings = [{
      containerPort = var.api_port
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "LOG_LEVEL", value = var.log_level },
      { name = "API_PORT", value = tostring(var.api_port) },
      { name = "BETTER_AUTH_URL", value = var.better_auth_url },
      { name = "WEB_URL", value = var.web_url },
      { name = "CORS_ORIGINS", value = var.cors_origins },
      { name = "EMAIL_PROVIDER", value = "ses" },
      { name = "EMAIL_FROM", value = var.email_from },
      { name = "AWS_REGION", value = var.ses_region },
      { name = "OTEL_SERVICE_NAME", value = "uptimeflow-api" },
    ]
    secrets          = local.api_secrets
    logConfiguration = local.log_config["api"]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.api_port}/healthz || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.web_cpu)
  memory                   = tostring(var.web_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "web"
    image     = local.images.web
    essential = true
    portMappings = [{
      containerPort = var.web_port
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = tostring(var.web_port) },
      { name = "HOSTNAME", value = "0.0.0.0" },
      { name = "NEXT_TELEMETRY_DISABLED", value = "1" },
    ]
    logConfiguration = local.log_config["web"]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -q --spider http://127.0.0.1:${var.web_port}/ || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.worker_cpu)
  memory                   = tostring(var.worker_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "worker"
    image     = local.images.worker
    essential = true
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "LOG_LEVEL", value = var.log_level },
      { name = "WEB_URL", value = var.web_url },
      { name = "EMAIL_PROVIDER", value = "ses" },
      { name = "EMAIL_FROM", value = var.email_from },
      { name = "AWS_REGION", value = var.ses_region },
      { name = "WORKER_CONCURRENCY", value = tostring(var.worker_concurrency) },
      { name = "EMAIL_MAX_RETRIES", value = "3" },
      { name = "OTEL_SERVICE_NAME", value = "uptimeflow-worker" },
    ]
    secrets          = local.data_secrets
    logConfiguration = local.log_config["worker"]
  }])
}

# One-off migration task — run via `aws ecs run-task` before each rollout.
# Reuses the api image (it carries pnpm + the prisma migration toolchain) and
# runs `pnpm db:deploy` (prisma migrate deploy). Never runs on container boot.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = local.images.api
    essential = true
    command   = ["pnpm", "db:deploy"]
    environment = [
      { name = "NODE_ENV", value = "production" },
    ]
    secrets          = [{ name = "DATABASE_URL", valueFrom = var.database_url_secret_arn }]
    logConfiguration = local.log_config["migrate"]
  }])
}
