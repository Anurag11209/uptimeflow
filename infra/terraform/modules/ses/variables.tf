variable "name_prefix" {
  description = "Prefix applied to named SES resources (e.g. configuration set)."
  type        = string
}

variable "domain_name" {
  description = "Domain used as the SES sending identity (e.g. \"uptimeflow.in\")."
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for the domain. Empty string means DNS is managed elsewhere; no Route53 records are created."
  type        = string
  default     = ""
}
