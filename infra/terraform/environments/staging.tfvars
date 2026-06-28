# Staging — production-like but smaller. Multi-AZ off to control cost; flip on
# to rehearse failover before a production change.
environment = "staging"
aws_region  = "us-east-1"

az_count           = 2
single_nat_gateway = true

domain_name = "uptimeflow.in"
web_domain  = "app.staging.uptimeflow.in"
api_domain  = "api.staging.uptimeflow.in"

db_instance_class        = "db.t4g.small"
db_allocated_storage     = 20
db_multi_az              = false
db_backup_retention_days = 7
db_performance_insights  = true

redis_node_type          = "cache.t4g.small"
redis_num_cache_clusters = 2
redis_multi_az           = true

api_cpu              = 512
api_memory           = 1024
api_desired_count    = 2
api_min_count        = 2
api_max_count        = 4
web_desired_count    = 2
worker_desired_count = 1

enable_deletion_protection = false
log_retention_days         = 14
