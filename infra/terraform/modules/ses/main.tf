locals {
  mail_from_domain = "mail.${var.domain_name}"
  manage_dns       = var.route53_zone_id != ""
}

# ---------------------------------------------------------------------------
# Domain identity + Easy DKIM
# ---------------------------------------------------------------------------
resource "aws_ses_domain_identity" "this" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "this" {
  domain = aws_ses_domain_identity.this.domain
}

# ---------------------------------------------------------------------------
# Custom MAIL FROM domain
# ---------------------------------------------------------------------------
resource "aws_ses_domain_mail_from" "this" {
  domain                 = aws_ses_domain_identity.this.domain
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "UseDefaultValue"
}

# ---------------------------------------------------------------------------
# SESv2 configuration set + CloudWatch event destination
# ---------------------------------------------------------------------------
resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = "${var.name_prefix}-emails"

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }
}

resource "aws_sesv2_configuration_set_event_destination" "cloudwatch" {
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  event_destination_name = "${var.name_prefix}-cloudwatch"

  event_destination {
    enabled              = true
    matching_event_types = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT"]

    cloud_watch_destination {
      dimension_configuration {
        dimension_name          = "ses:configuration-set"
        dimension_value_source  = "MESSAGE_TAG"
        default_dimension_value = "default"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# DNS records (only when a Route53 zone is supplied)
# ---------------------------------------------------------------------------
resource "aws_route53_record" "dkim" {
  for_each = local.manage_dns ? toset(aws_ses_domain_dkim.this.dkim_tokens) : toset([])

  zone_id = var.route53_zone_id
  name    = "${each.value}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${each.value}.dkim.amazonses.com"]
}

resource "aws_route53_record" "mail_from_mx" {
  count = local.manage_dns ? 1 : 0

  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${data.aws_region.current.name}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  count = local.manage_dns ? 1 : 0

  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

data "aws_region" "current" {}
