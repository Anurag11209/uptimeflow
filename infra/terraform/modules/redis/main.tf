resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.name_prefix}-redis7"
  family = "redis7"

  # BullMQ requires that Redis never evicts keys; eviction policies such as
  # allkeys-lru would silently drop queued jobs.
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "random_password" "auth_token" {
  length  = 32
  special = false
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "Redis for ${var.name_prefix} (sessions, rate limiting, BullMQ)."

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  parameter_group_name = aws_elasticache_parameter_group.this.name

  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [var.security_group_id]

  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.multi_az
  multi_az_enabled           = var.multi_az

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth_token.result

  snapshot_retention_limit = 5
  snapshot_window          = "03:00-04:00"
  maintenance_window       = "sun:04:30-sun:05:30"

  apply_immediately = false
}

locals {
  redis_url = "rediss://:${random_password.auth_token.result}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
}

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "${var.name_prefix}/redis-url"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = local.redis_url
}
