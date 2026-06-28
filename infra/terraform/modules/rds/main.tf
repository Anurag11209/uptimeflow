###############################################################################
# Amazon RDS PostgreSQL for UptimeFlow
#
# Well-Architected notes:
#  - Instance lives only in private subnets (no public access).
#  - Storage encrypted at rest with the default aws/rds KMS key.
#  - Automated backups + final snapshot when deletion protection is on.
#  - Enhanced monitoring + Performance Insights are opt-in.
#  - SSL is forced at the parameter-group level (rds.force_ssl).
#  - The composed DATABASE_URL is stored in Secrets Manager, never output.
#
# Provider config (region, default_tags) and required_providers are expected
# from the root module — no provider/terraform blocks are declared here.
###############################################################################

#######################################
# Networking: DB subnet group
#######################################

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-postgres"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.name_prefix}-postgres"
  }
}

#######################################
# Parameter group (postgres16)
#######################################

resource "aws_db_parameter_group" "this" {
  name        = "${var.name_prefix}-postgres16"
  family      = "postgres16"
  description = "Custom parameters for ${var.name_prefix} PostgreSQL 16"

  # Log statements slower than 1s to CloudWatch for performance triage.
  parameter {
    name         = "log_min_duration_statement"
    value        = "1000"
    apply_method = "immediate"
  }

  # Require TLS for all client connections. Static param -> needs a reboot.
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  lifecycle {
    create_before_destroy = true
  }
}

#######################################
# Master password (random, URL-safe)
#######################################

# override_special intentionally EXCLUDES characters that would break either a
# URL or a Postgres connection string (notably '/', '@', ':', and space).
# Because of this constraint the password can be interpolated into the
# connection string below without any additional URL-encoding step.
resource "random_password" "master" {
  length           = 32
  special          = true
  override_special = "!#%*-_=+"
}

#######################################
# Enhanced monitoring IAM role (optional)
#######################################

data "aws_iam_policy_document" "monitoring_assume" {
  count = var.monitoring_interval > 0 ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count              = var.monitoring_interval > 0 ? 1 : 0
  name               = "${var.name_prefix}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume[0].json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count      = var.monitoring_interval > 0 ? 1 : 0
  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

#######################################
# RDS instance
#######################################

resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "16"
  # Major-version-only string lets RDS auto-select/upgrade minor versions while
  # we explicitly forbid major upgrades.
  allow_major_version_upgrade = false
  auto_minor_version_upgrade  = true

  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true # default aws/rds KMS key (kms_key_id omitted)

  db_name  = var.database_name
  username = var.master_username
  password = random_password.master.result
  port     = 5432

  manage_master_user_password = false

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period = var.backup_retention_days
  # Non-overlapping windows (UTC). Backup runs before the maintenance window.
  backup_window      = "03:00-04:00"
  maintenance_window = "sun:04:30-sun:05:30"

  copy_tags_to_snapshot = true
  deletion_protection   = var.deletion_protection

  # When deletion protection is on, keep a final snapshot; otherwise skip it.
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${var.name_prefix}-postgres-final" : null

  performance_insights_enabled = var.performance_insights

  monitoring_interval = var.monitoring_interval
  monitoring_role_arn = var.monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  apply_immediately = false

  tags = {
    Name = "${var.name_prefix}-postgres"
  }
}

#######################################
# Connection string -> Secrets Manager
#######################################

locals {
  # Prisma expects a single DATABASE_URL. The password is safe to interpolate
  # directly because random_password.override_special excludes URL/Postgres
  # delimiters ('/', '@', ':', space, '?', '#').
  database_url = "postgresql://${var.master_username}:${random_password.master.result}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${var.database_name}?schema=public&sslmode=require"
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.name_prefix}/database-url"
  description             = "DATABASE_URL connection string for ${var.name_prefix} PostgreSQL"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}
