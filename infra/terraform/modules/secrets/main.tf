# Application secrets in AWS Secrets Manager (never plaintext .env in prod).
#
# Two classes:
#   1. Generated here (Terraform owns the value): BETTER_AUTH_SECRET, METRICS_TOKEN.
#   2. Externally sourced (Stripe / OAuth / Resend): created as empty containers
#      seeded with a "CHANGE_ME" placeholder, then populated out-of-band
#      (console / CI / `aws secretsmanager put-secret-value`). Terraform ignores
#      later value changes so it never reverts the real secret.
#
# DATABASE_URL and REDIS_URL are created by the rds/redis modules.

locals {
  # External secrets the operator must populate. Key → env var documented in README.
  external_keys = [
    "stripe_secret_key",
    "stripe_webhook_secret",
    "stripe_publishable_key",
    "github_client_id",
    "github_client_secret",
    "google_client_id",
    "google_client_secret",
    "resend_api_key",
  ]
}

# ── Generated secrets ─────────────────────────────────────────────────
resource "random_password" "better_auth_secret" {
  length  = 48
  special = false # base64-ish; avoids shell/url escaping issues
}

resource "random_password" "metrics_token" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "better_auth_secret" {
  name                    = "${var.name_prefix}/app/better-auth-secret"
  description             = "Better Auth signing secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "better_auth_secret" {
  secret_id     = aws_secretsmanager_secret.better_auth_secret.id
  secret_string = random_password.better_auth_secret.result
}

resource "aws_secretsmanager_secret" "metrics_token" {
  name                    = "${var.name_prefix}/app/metrics-token"
  description             = "Bearer token guarding GET /metrics"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "metrics_token" {
  secret_id     = aws_secretsmanager_secret.metrics_token.id
  secret_string = random_password.metrics_token.result
}

# ── External secrets (placeholders; populate out-of-band) ─────────────
resource "aws_secretsmanager_secret" "external" {
  for_each                = toset(local.external_keys)
  name                    = "${var.name_prefix}/app/${replace(each.key, "_", "-")}"
  description             = "Populate out-of-band; Terraform does not manage the value"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "external" {
  for_each      = aws_secretsmanager_secret.external
  secret_id     = each.value.id
  secret_string = "CHANGE_ME"

  # Operator sets the real value; never let Terraform overwrite it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
