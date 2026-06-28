# UptimeFlow — AWS Infrastructure (Terraform)

Production-grade AWS infrastructure for UptimeFlow on ECS Fargate, following the
AWS Well-Architected Framework. One reusable root module serves `dev`, `staging`,
and `production` via `environments/*.tfvars`.

## Architecture

```
                       Route53 / Cloudflare (DNS)
                                 │
                         ACM (TLS) │
                    ┌──────────────▼──────────────┐
   internet ──443──►│  Application Load Balancer   │  (public subnets, multi-AZ)
                    └───────┬─────────────┬────────┘
              host=api / path /api,/v1    │ default
                            │             │
                    ┌───────▼──────┐ ┌────▼───────┐   ┌──────────────┐
                    │ api service  │ │ web service│   │worker service│  (private subnets)
                    │ Fargate ≥2   │ │ Fargate ≥2 │   │ Fargate ≥1   │
                    └───┬─────┬────┘ └────────────┘   └──┬────────┬──┘
                        │     │                          │        │
                  ┌─────▼─┐ ┌─▼───────────────┐    ┌─────▼─┐  ┌───▼────────┐
                  │  RDS  │ │  ElastiCache    │◄───┤ Redis │  │ SES (email)│
                  │  PG   │ │  Redis (queues) │    └───────┘  └────────────┘
                  └───────┘ └─────────────────┘
   Secrets Manager → injected as task secrets   CloudWatch Logs/Metrics/Alarms
   ECR → images          S3 → audit-log archive + ALB access logs
   GitHub OIDC role → CI pushes images & deploys (no static keys)
```

## Modules

| Module | Provisions |
|---|---|
| `network` | VPC, public/private subnets (per AZ), IGW, NAT gateway(s), route tables |
| `security` | Security groups (alb → api/web → rds/redis; worker egress-only) |
| `ecr` | One immutable, scan-on-push ECR repo per app + lifecycle policies |
| `s3` | Audit-log bucket (versioned, lifecycle) + ALB access-log bucket |
| `ses` | SES domain identity, DKIM, custom MAIL FROM, config set → CloudWatch |
| `secrets` | Secrets Manager: generated auth/metrics secrets + external placeholders |
| `rds` | PostgreSQL 16 (gp3, encrypted, backups, enhanced monitoring, PI) + URL secret |
| `redis` | ElastiCache Redis (encryption in transit+rest, auth token) + URL secret |
| `alb` | ALB, HTTPS listener, HTTP→HTTPS redirect, api/web target groups + routing |
| `ecs` | Cluster (Container Insights), task defs, services, autoscaling, IAM, log groups |
| `observability` | SNS alarm topic, CloudWatch alarms (ALB/ECS/RDS/Redis), dashboard |
| `github_oidc` | GitHub Actions OIDC provider + least-privilege deploy role |

## Prerequisites (once per AWS account)

1. **State bucket** — create the S3 backend bucket (private, versioned, encrypted).
   See the header of `backend.tf` for the exact commands.
2. **ACM certificate** — request/import a cert in `aws_region` covering
   `web_domain` + `api_domain` (e.g. `app.uptimeflow.in`, `api.uptimeflow.in`).
   Put its ARN in `acm_certificate_arn`.
3. **Terraform ≥ 1.6** and AWS credentials with admin (for the first apply).

## Deploy

```bash
cd infra/terraform

# Initialize against the remote state (distinct key per environment).
terraform init \
  -backend-config="bucket=uptimeflow-tfstate" \
  -backend-config="key=production/terraform.tfstate" \
  -backend-config="region=us-east-1"

# Review and apply.
terraform plan  -var-file=environments/production.tfvars
terraform apply -var-file=environments/production.tfvars
```

### First-apply notes (bootstrapping)

- ECR repos are created empty. Until the first images are pushed, the ECS
  services will not reach a steady state — that's expected. Push images via CI
  (set `DEPLOY_ENABLED=true`) or manually, then the services stabilize.
- `terraform apply` generates the DB password and Redis auth token and stores the
  composed `DATABASE_URL` / `REDIS_URL` in Secrets Manager automatically — no
  manual URL assembly. (Generated values live in encrypted remote state; keep the
  state bucket locked down.)

### Post-apply: populate external secrets

The `secrets` module creates placeholders (value `CHANGE_ME`, Terraform ignores
later changes). Set the real values once:

```bash
P=uptimeflow-production/app
aws secretsmanager put-secret-value --secret-id $P/stripe-secret-key      --secret-string 'sk_live_…'
aws secretsmanager put-secret-value --secret-id $P/stripe-webhook-secret  --secret-string 'whsec_…'
aws secretsmanager put-secret-value --secret-id $P/stripe-publishable-key --secret-string 'pk_live_…'
aws secretsmanager put-secret-value --secret-id $P/github-client-id       --secret-string '…'
aws secretsmanager put-secret-value --secret-id $P/github-client-secret   --secret-string '…'
aws secretsmanager put-secret-value --secret-id $P/google-client-id       --secret-string '…'
aws secretsmanager put-secret-value --secret-id $P/google-client-secret   --secret-string '…'
aws secretsmanager put-secret-value --secret-id $P/resend-api-key         --secret-string '…'   # only if used
```

Force a new deployment so tasks pick up changed secrets:
`aws ecs update-service --cluster uptimeflow-production --service uptimeflow-production-api --force-new-deployment`.

### DNS & SES

- Point `web_domain`/`api_domain` at `alb_dns_name` (CNAME, or Route53 alias via
  `alb_zone_id`).
- Publish the SES DKIM records: if `route53_zone_id` is set they're created
  automatically; otherwise publish the `ses_dkim_tokens` output as CNAMEs and
  request production SES access (exit the sandbox).

### Wire CI/CD

Set repo **secret** `AWS_DEPLOY_ROLE_ARN` = `terraform output
github_actions_deploy_role_arn`, and the **variables** listed in
`.github/workflows/ci.yml` (`DEPLOY_ENABLED`, `AWS_REGION`, `ECS_CLUSTER`,
`ECS_SUBNETS`, `ECS_SECURITY_GROUP`, `NEXT_PUBLIC_API_URL`). On push to `main`,
CI builds images → pushes to ECR → runs the migration task → rolls the services.

## Cost levers

`environments/dev.tfvars` uses a shared NAT, micro instances, single nodes, and
short retention. Production uses 3 AZs, NAT per AZ, Multi-AZ RDS/Redis, deletion
protection, and longer retention. Tune instance classes and `*_min/max_count`
to your load. See `docs/disaster-recovery.md` for backup/restore.
