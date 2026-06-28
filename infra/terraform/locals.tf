locals {
  name_prefix = "${var.project}-${var.environment}"
  account_id  = data.aws_caller_identity.current.account_id

  # Public URLs the application is reached on (baked into config + Better Auth).
  web_url         = "https://${var.web_domain}"
  api_url         = "https://${var.api_domain}"
  better_auth_url = "https://${var.api_domain}"
}
