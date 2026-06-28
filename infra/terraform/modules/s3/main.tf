###############################################################################
# Audit logs bucket
###############################################################################

resource "aws_s3_bucket" "audit_logs" {
  bucket        = "${var.name_prefix}-audit-logs"
  force_destroy = var.force_destroy

  tags = {
    Name = "${var.name_prefix}-audit-logs"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_public_access_block" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  # Ensure versioning is configured before lifecycle rules that act on versions.
  depends_on = [aws_s3_bucket_versioning.audit_logs]

  rule {
    id     = "audit-logs-retention"
    status = "Enabled"

    filter {}

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_expiration_days
    }
  }
}

###############################################################################
# ALB access logs bucket
###############################################################################

resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${var.name_prefix}-alb-logs"
  force_destroy = var.force_destroy

  tags = {
    Name = "${var.name_prefix}-alb-logs"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  versioning_configuration {
    status = "Suspended"
  }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    id     = "alb-logs-expiration"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }
  }
}

###############################################################################
# ALB access logs bucket policy
###############################################################################

data "aws_elb_service_account" "main" {}

data "aws_iam_policy_document" "alb_logs" {
  # Allow the regional ELB service account to write access logs.
  statement {
    sid     = "AllowELBServiceAccountPutObject"
    effect  = "Allow"
    actions = ["s3:PutObject"]

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }

    resources = ["${aws_s3_bucket.alb_logs.arn}/*"]
  }

  # Allow the modern log delivery service to write access logs.
  statement {
    sid     = "AllowLogDeliveryPutObject"
    effect  = "Allow"
    actions = ["s3:PutObject"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.alb_logs.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }

  # Allow the log delivery service to read the bucket ACL.
  statement {
    sid     = "AllowLogDeliveryGetBucketAcl"
    effect  = "Allow"
    actions = ["s3:GetBucketAcl"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    resources = [aws_s3_bucket.alb_logs.arn]
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  count = var.alb_access_logs_enabled ? 1 : 0

  bucket = aws_s3_bucket.alb_logs.id
  policy = data.aws_iam_policy_document.alb_logs.json

  # Public access block must be in place before applying a bucket policy.
  depends_on = [aws_s3_bucket_public_access_block.alb_logs]
}
