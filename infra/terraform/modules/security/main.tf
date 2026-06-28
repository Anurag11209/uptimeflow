# Security groups implementing least-privilege flow:
#   internet → ALB(443/80) → api(api_port)/web(web_port) → rds(5432)/redis(6379)
#   worker has no ingress; it reaches rds/redis as a client.
# Modern rule resources (aws_vpc_security_group_*_rule) are used so each rule is
# an independent, referenceable resource.

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "ALB ingress from the internet"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-alb" }
}

resource "aws_security_group" "api" {
  name        = "${var.name_prefix}-api"
  description = "API tasks; ingress from ALB only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-api" }
}

resource "aws_security_group" "web" {
  name        = "${var.name_prefix}-web"
  description = "Web tasks; ingress from ALB only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-web" }
}

resource "aws_security_group" "worker" {
  name        = "${var.name_prefix}-worker"
  description = "Worker tasks; no ingress"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-worker" }
}

resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds"
  description = "PostgreSQL; ingress from api + worker only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-rds" }
}

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis"
  description = "Redis; ingress from api + worker only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-redis" }
}

# ── ALB ingress (public) ──────────────────────────────────────────────
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from internet"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from internet (redirected to HTTPS)"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

# ── App ingress from ALB ──────────────────────────────────────────────
resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "API port from ALB"
  from_port                    = var.api_port
  to_port                      = var.api_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  description                  = "Web port from ALB"
  from_port                    = var.web_port
  to_port                      = var.web_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

# ── Data-store ingress from app tiers ─────────────────────────────────
resource "aws_vpc_security_group_ingress_rule" "rds_from_api" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Postgres from api"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_worker" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Postgres from worker"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.worker.id
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_api" {
  security_group_id            = aws_security_group.redis.id
  description                  = "Redis from api"
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_worker" {
  security_group_id            = aws_security_group.redis.id
  description                  = "Redis from worker"
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.worker.id
}

# ── Egress: allow all outbound for every SG ───────────────────────────
resource "aws_vpc_security_group_egress_rule" "all" {
  for_each = {
    alb    = aws_security_group.alb.id
    api    = aws_security_group.api.id
    web    = aws_security_group.web.id
    worker = aws_security_group.worker.id
    rds    = aws_security_group.rds.id
    redis  = aws_security_group.redis.id
  }
  security_group_id = each.value
  description       = "Allow all outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
