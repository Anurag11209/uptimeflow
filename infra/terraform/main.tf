# Root module — wires the building blocks into one environment. The dependency
# graph is: network → security → (rds, redis, alb, ecs); secrets/ecr/s3/ses feed
# ecs; observability + github_oidc consume the resources created above.

module "network" {
  source = "./modules/network"

  name_prefix        = local.name_prefix
  vpc_cidr           = var.vpc_cidr
  az_count           = var.az_count
  single_nat_gateway = var.single_nat_gateway
}

module "security" {
  source = "./modules/security"

  name_prefix = local.name_prefix
  vpc_id      = module.network.vpc_id
  vpc_cidr    = module.network.vpc_cidr
  api_port    = var.api_port
  web_port    = var.web_port
}

module "ecr" {
  source = "./modules/ecr"

  name_prefix     = local.name_prefix
  repositories    = var.ecr_repositories
  max_image_count = var.ecr_max_image_count
}

module "s3" {
  source = "./modules/s3"

  name_prefix                = local.name_prefix
  enable_versioning          = var.s3_versioning
  force_destroy              = var.s3_force_destroy
  noncurrent_expiration_days = var.s3_noncurrent_expiration_days
  alb_access_logs_enabled    = var.alb_access_logs_enabled
}

module "ses" {
  source = "./modules/ses"

  name_prefix     = local.name_prefix
  domain_name     = var.domain_name
  route53_zone_id = var.route53_zone_id
}

module "secrets" {
  source = "./modules/secrets"

  name_prefix = local.name_prefix
}

module "rds" {
  source = "./modules/rds"

  name_prefix           = local.name_prefix
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  security_group_id     = module.security.rds_sg_id
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = var.enable_deletion_protection
  database_name         = var.db_name
  master_username       = var.db_username
  monitoring_interval   = var.db_monitoring_interval
  performance_insights  = var.db_performance_insights
}

module "redis" {
  source = "./modules/redis"

  name_prefix        = local.name_prefix
  subnet_ids         = module.network.private_subnet_ids
  security_group_id  = module.security.redis_sg_id
  node_type          = var.redis_node_type
  num_cache_clusters = var.redis_num_cache_clusters
  multi_az           = var.redis_multi_az
  engine_version     = var.redis_engine_version
}

module "alb" {
  source = "./modules/alb"

  name_prefix         = local.name_prefix
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = module.network.public_subnet_ids
  security_group_id   = module.security.alb_sg_id
  certificate_arn     = var.acm_certificate_arn
  api_port            = var.api_port
  web_port            = var.web_port
  api_host            = var.api_domain
  api_health_path     = "/readyz"
  web_health_path     = "/"
  access_logs_bucket  = module.s3.alb_logs_bucket_id
  enable_access_logs  = var.alb_access_logs_enabled
  deletion_protection = var.enable_deletion_protection
}

module "ecs" {
  source = "./modules/ecs"

  name_prefix               = local.name_prefix
  aws_region                = var.aws_region
  private_subnet_ids        = module.network.private_subnet_ids
  api_security_group_id     = module.security.api_sg_id
  web_security_group_id     = module.security.web_sg_id
  worker_security_group_id  = module.security.worker_sg_id
  enable_container_insights = var.enable_container_insights
  log_retention_days        = var.log_retention_days

  repository_urls = module.ecr.repository_urls
  image_tag       = var.image_tag

  api_target_group_arn = module.alb.api_target_group_arn
  web_target_group_arn = module.alb.web_target_group_arn

  # Secret injection (Secrets Manager ARNs only — never plaintext).
  database_url_secret_arn = module.rds.database_url_secret_arn
  redis_url_secret_arn    = module.redis.redis_url_secret_arn
  app_secret_arns         = module.secrets.secret_arns

  # Non-secret runtime config.
  better_auth_url   = local.better_auth_url
  web_url           = local.web_url
  cors_origins      = var.cors_origins
  log_level         = var.log_level
  email_from        = var.email_from
  ses_region        = var.aws_region
  ses_identity_arn  = module.ses.domain_identity_arn
  audit_logs_bucket = module.s3.audit_logs_bucket_id
  audit_logs_arn    = module.s3.audit_logs_bucket_arn

  # Ports + sizing.
  api_port           = var.api_port
  web_port           = var.web_port
  worker_concurrency = var.worker_concurrency

  api_cpu           = var.api_cpu
  api_memory        = var.api_memory
  api_desired_count = var.api_desired_count
  api_min_count     = var.api_min_count
  api_max_count     = var.api_max_count

  web_cpu           = var.web_cpu
  web_memory        = var.web_memory
  web_desired_count = var.web_desired_count
  web_min_count     = var.web_min_count
  web_max_count     = var.web_max_count

  worker_cpu           = var.worker_cpu
  worker_memory        = var.worker_memory
  worker_desired_count = var.worker_desired_count
  worker_min_count     = var.worker_min_count
  worker_max_count     = var.worker_max_count

  # ECS services attach to ALB target groups, which must already be wired to a
  # listener before the service is created.
  depends_on = [module.alb]
}

module "observability" {
  source = "./modules/observability"

  name_prefix       = local.name_prefix
  aws_region        = var.aws_region
  alarm_email       = var.alarm_email
  alb_arn_suffix    = module.alb.alb_arn_suffix
  api_tg_arn_suffix = module.alb.api_tg_arn_suffix
  web_tg_arn_suffix = module.alb.web_tg_arn_suffix
  ecs_cluster_name  = module.ecs.cluster_name
  ecs_service_names = module.ecs.service_names_list
  rds_instance_id   = module.rds.db_instance_id
  redis_cluster_id  = module.redis.replication_group_id
}

module "github_oidc" {
  source = "./modules/github_oidc"

  name_prefix         = local.name_prefix
  github_owner        = var.github_owner
  github_repo         = var.github_repo
  ecr_repository_arns = values(module.ecr.repository_arns)
  ecs_cluster_arn     = module.ecs.cluster_arn
  ecs_service_arns    = module.ecs.service_arns_list
  task_role_arns      = module.ecs.passable_role_arns
}
