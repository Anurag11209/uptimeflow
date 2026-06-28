variable "name_prefix" {
  description = "Prefix used to name all ElastiCache and related resources."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs the Redis nodes are placed in."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID for Redis (allows 6379 from app SGs)."
  type        = string
}

variable "node_type" {
  description = "ElastiCache node instance type (e.g. cache.t4g.small)."
  type        = string
}

variable "num_cache_clusters" {
  description = "Total number of cache nodes. Use >= 2 to enable automatic failover."
  type        = number
}

variable "multi_az" {
  description = "Enable Multi-AZ with automatic failover. Requires num_cache_clusters >= 2."
  type        = bool
}

variable "engine_version" {
  description = "Redis engine version (e.g. 7.1)."
  type        = string
}
