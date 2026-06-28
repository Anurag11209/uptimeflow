# Remote state lives in S3 with native state locking (use_lockfile, Terraform
# >= 1.10 — no DynamoDB table required). State is sensitive (it can contain
# generated DB/Redis credentials), so the bucket MUST be private, encrypted, and
# versioned. Create it ONCE per account before the first `terraform init`:
#
#   aws s3api create-bucket --bucket uptimeflow-tfstate --region us-east-1
#   aws s3api put-bucket-versioning --bucket uptimeflow-tfstate \
#     --versioning-configuration Status=Enabled
#   aws s3api put-bucket-encryption --bucket uptimeflow-tfstate \
#     --server-side-encryption-configuration \
#     '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
#   aws s3api put-public-access-block --bucket uptimeflow-tfstate \
#     --public-access-block-configuration \
#     BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
#
# Initialize per environment with a distinct state key, e.g.:
#   terraform init -backend-config="bucket=uptimeflow-tfstate" \
#                  -backend-config="key=production/terraform.tfstate" \
#                  -backend-config="region=us-east-1"
#
# Left partially-configured on purpose so the same code serves dev/staging/prod
# via -backend-config. For local validation only, run with `-backend=false`.
terraform {
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}
