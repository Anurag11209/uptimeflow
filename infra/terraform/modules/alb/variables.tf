variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener (must cover web + api hosts)."
  type        = string
}

variable "api_port" {
  type = number
}

variable "web_port" {
  type = number
}

variable "api_host" {
  description = "Hostname routed to the API target group."
  type        = string
}

variable "api_health_path" {
  type = string
}

variable "web_health_path" {
  type = string
}

variable "access_logs_bucket" {
  type = string
}

variable "enable_access_logs" {
  type = bool
}

variable "deletion_protection" {
  type = bool
}
