provider "aws" {
  region = var.aws_region

  # Every resource is tagged consistently for cost allocation and ownership.
  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
