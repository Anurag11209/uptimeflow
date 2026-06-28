output "domain_identity_arn" {
  description = "ARN of the SES domain identity."
  value       = aws_ses_domain_identity.this.arn
}

output "dkim_tokens" {
  description = "DKIM tokens for the domain so DNS records can be published manually."
  value       = aws_ses_domain_dkim.this.dkim_tokens
}
