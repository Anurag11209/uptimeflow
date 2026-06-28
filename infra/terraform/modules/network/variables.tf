variable "name_prefix" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "az_count" {
  type = number
}

variable "single_nat_gateway" {
  description = "Share one NAT Gateway across AZs (cheaper) vs one per AZ (HA)."
  type        = bool
}
