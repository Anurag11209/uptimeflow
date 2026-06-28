variable "name_prefix" {
  description = "Prefix applied to every ECR repository name (e.g. \"uptimeflow-production\")."
  type        = string
}

variable "repositories" {
  description = "List of short repository names to create (e.g. [\"api\", \"worker\", \"web\"])."
  type        = list(string)
}

variable "max_image_count" {
  description = "Maximum number of tagged images to retain per repository."
  type        = number
}
