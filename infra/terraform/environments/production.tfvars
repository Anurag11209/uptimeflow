# Production — Multi-AZ, NAT per AZ, deletion protection, longer retention.
environment = "production"
aws_region  = "us-east-1"

# Networking — 3 AZs, one NAT per AZ for HA egress.
az_count           = 3
single_nat_gateway = false

domain_name = "uptimeflow.in"
web_domain  = "app.uptimeflow.in"
api_domain  = "api.uptimeflow.in"

# RDS — Multi-AZ, storage autoscaling headroom, 30-day PITR.
db_instance_class        = "db.r6g.large"
db_allocated_storage     = 100
db_max_allocated_storage = 500
db_multi_az              = true
db_backup_retention_days = 30
db_performance_insights  = true
db_monitoring_interval   = 30

# Redis — Multi-AZ replication group with automatic failover.
redis_node_type          = "cache.r6g.large"
redis_num_cache_clusters = 2
redis_multi_az           = true

# ECS — HA baseline with headroom to scale out.
api_cpu              = 1024
api_memory           = 2048
api_desired_count    = 3
api_min_count        = 3
api_max_count        = 12
web_cpu              = 512
web_memory           = 1024
web_desired_count    = 3
web_min_count        = 2
web_max_count        = 8
worker_cpu           = 1024
worker_memory        = 2048
worker_desired_count = 2
worker_min_count     = 2
worker_max_count     = 8
worker_concurrency   = 20

# Safety / retention.
enable_deletion_protection = true
s3_force_destroy           = false
log_retention_days         = 90
alarm_email                = "ops@uptimeflow.in"
