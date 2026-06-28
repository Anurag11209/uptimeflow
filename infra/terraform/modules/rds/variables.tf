variable "name_prefix" {
  description = "Prefix applied to all resource names/identifiers."
  type        = string
}

variable "vpc_id" {
  description = "VPC the RDS instance lives in."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)
}

variable "security_group_id" {
  description = "ID of the RDS security group (already allows 5432 from app SGs)."
  type        = string
}

variable "instance_class" {
  description = "RDS instance class (e.g. db.t4g.medium)."
  type        = string
}

variable "allocated_storage" {
  description = "Initial allocated storage in GiB."
  type        = number
}

variable "max_allocated_storage" {
  description = "Upper bound for storage autoscaling in GiB."
  type        = number
}

variable "multi_az" {
  description = "Whether to deploy a Multi-AZ standby."
  type        = bool
}

variable "backup_retention_days" {
  description = "Number of days to retain automated backups."
  type        = number
}

variable "deletion_protection" {
  description = "Protect the instance from deletion. Also drives final snapshot behavior."
  type        = bool
}

variable "database_name" {
  description = "Name of the initial database created on the instance."
  type        = string
}

variable "master_username" {
  description = "Master (admin) username."
  type        = string
}

variable "monitoring_interval" {
  description = "Enhanced monitoring interval in seconds. 0 disables enhanced monitoring."
  type        = number
}

variable "performance_insights" {
  description = "Enable Performance Insights."
  type        = bool
}
