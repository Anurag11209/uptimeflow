# Development — single-AZ, smallest instances, cost-optimized. Not HA.
environment = "dev"
aws_region  = "us-east-1"

# Networking — one NAT to save ~$32/mo per extra AZ gateway.
az_count           = 2
single_nat_gateway = true

# DNS / TLS — set acm_certificate_arn after requesting a cert.
domain_name = "uptimeflow.in"
web_domain  = "app.dev.uptimeflow.in"
api_domain  = "api.dev.uptimeflow.in"

# RDS — tiny, single-AZ, short backups.
db_instance_class        = "db.t4g.micro"
db_allocated_storage     = 20
db_multi_az              = false
db_backup_retention_days = 3
db_performance_insights  = false

# Redis — single node.
redis_node_type          = "cache.t4g.micro"
redis_num_cache_clusters = 1
redis_multi_az           = false

# ECS — one task each.
api_cpu              = 256
api_memory           = 512
api_desired_count    = 1
api_min_count        = 1
api_max_count        = 2
web_desired_count    = 1
web_min_count        = 1
worker_desired_count = 1

# Safety / convenience.
enable_deletion_protection = false
s3_force_destroy           = true
log_retention_days         = 7
