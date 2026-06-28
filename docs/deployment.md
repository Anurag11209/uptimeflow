# Deployment Guide

Two paths: **local / self-host** with Docker Compose, and **production** on
AWS ECS Fargate. Phase 1 ships three deployables — `api`, `worker`, `web` —
plus Postgres and Redis.

## Local & self-host (Docker Compose)

```bash
# 1. Bring up infra
docker compose up -d postgres redis mailpit

# 2. Apply schema + demo data
pnpm db:migrate
pnpm db:seed

# 3a. Dev with hot reload (recommended)
pnpm dev

# 3b. …or run the full containerized stack
docker compose up --build
```

- Web: http://localhost:3000 · API: http://localhost:4000
- Mailpit (captured emails): http://localhost:8025
- Optional observability: `docker compose --profile observability up -d`
  → Prometheus :9090, Grafana :3001 (admin/admin)

## Production architecture (AWS)

> **Now codified as Terraform** in [`infra/terraform`](../infra/terraform/README.md).
> The diagram below is implemented by those modules (VPC, ALB, ECS Fargate, RDS,
> ElastiCache, S3, SES, Secrets Manager, CloudWatch, ECR, GitHub OIDC). Deploy
> with `terraform apply -var-file=environments/<env>.tfvars`. Backup/restore is in
> [`docs/disaster-recovery.md`](./disaster-recovery.md).

```
Cloudflare (TLS, WAF, DNS)
        │
   ALB (HTTPS)
   ├── /            → web   service (Fargate, ≥2 tasks, multi-AZ)
   └── /api, /v1    → api   service (Fargate, ≥2 tasks, multi-AZ)
                         │
   worker service (Fargate, no ingress) ── consumes Redis queues
        │
   RDS PostgreSQL (Multi-AZ)      ElastiCache Redis (Multi-AZ, failover)
```

### Images

Each app has a multi-stage Dockerfile. The runner stage copies the built
workspace and runs as a non-root user.

> **Image-size note.** The api/worker runners currently copy the whole
> installed workspace to preserve pnpm's symlinked `node_modules`. To slim
> images, switch to `pnpm deploy --filter <app> --prod /out` in the builder and
> copy only `/out` into the runner. The web image already uses Next.js
> `output: "standalone"`, which bundles only the files the server needs.

Build and push (per app):

```bash
docker build -f apps/api/Dockerfile -t $ECR/backend-uptime-api:$SHA .
docker build -f apps/worker/Dockerfile -t $ECR/backend-uptime-worker:$SHA .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  -t $ECR/backend-uptime-web:$SHA .
```

`NEXT_PUBLIC_API_URL` is inlined at **build** time — bake the production API
URL into the web image; it cannot be changed at runtime.

### Secrets & configuration

Store secrets in AWS SSM Parameter Store / Secrets Manager and inject as task
environment. Required per service:

| Service | Variables |
|---|---|
| api | `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_URL`, `CORS_ORIGINS`, `METRICS_TOKEN`, email + OAuth vars |
| worker | `DATABASE_URL`, `REDIS_URL`, `WEB_URL`, `EMAIL_PROVIDER`, `EMAIL_FROM`, SES vars (below), `WORKER_CONCURRENCY` |
| web | `NEXT_PUBLIC_API_URL` (build arg) |

`BETTER_AUTH_SECRET` and `METRICS_TOKEN` must be strong and unique per
environment; the API refuses to start in production without `METRICS_TOKEN`.

### Email (Amazon SES)

Production email is delivered via **Amazon SES** (`@aws-sdk/client-sesv2`, no
SMTP). The sending domain **`uptimeflow.in`** must be verified in SES
(`us-east-1`), and the account must be out of the SES sandbox to email
arbitrary recipients.

```
EMAIL_PROVIDER=ses
EMAIL_FROM=alerts@uptimeflow.in
AWS_REGION=us-east-1
EMAIL_MAX_RETRIES=3
# Credentials: prefer the task/instance IAM role (ses:SendEmail, ses:GetAccount)
# and OMIT static keys. Use static keys only for local/CI.
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Required IAM permissions: `ses:SendEmail`, `ses:GetAccount`. The worker is the
sender (queue-first); the API only exposes the health check.

- **Health:** `GET /internal/email/health` → `{ provider, status, region }`
  (200 healthy / 503 unhealthy). Probe it after deploy and alert on `unhealthy`.
- **Observability:** the SES provider emits structured logs (`provider`,
  `recipient`, `template`, `status`, `error`) and the metrics
  `emails_sent_total`, `emails_failed_total`, `email_send_duration_ms`,
  `email_retry_total`. Retries use exponential backoff with jitter on throttling
  / 5xx / network errors only; rejected recipients and auth errors fail fast.

### Database migrations

Run `prisma migrate deploy` as a **one-off release task** before rolling new
app tasks — never on container boot, so concurrent tasks don't race:

```bash
aws ecs run-task --cluster backend-uptime \
  --task-definition backend-uptime-migrate \
  --launch-type FARGATE   # runs: pnpm db:deploy
```

### Zero-downtime rollout

ECS rolling deployments with `minimumHealthyPercent: 100`,
`maximumPercent: 200`, and ALB health checks against `/readyz` (api) and `/`
(web). `/readyz` fails closed when Postgres or Redis is unreachable, so
unhealthy tasks never receive traffic. The worker drains in-flight jobs on
SIGTERM (15 s grace) before exit.

### Observability in production

Point `OTEL_EXPORTER_OTLP_ENDPOINT` at your collector (e.g. an ADOT
sidecar/Grafana Agent) to ship traces and metrics. Scrape the api `/metrics`
endpoint with the bearer token. Alert on readiness failures, error-envelope
5xx rates, and queue depth/age for the email queue.

> **ESM + OTel note.** Under pure ESM, full auto-instrumentation can require a
> Node loader flag (e.g. `--import @opentelemetry/instrumentation/hook.mjs`)
> depending on the instrumentation versions. The entrypoint already loads the
> SDK before importing Express; add the loader flag if spans for a given
> library don't appear.

### Backups & DR

Full runbook (objectives, restore commands, region rebuild):
[`docs/disaster-recovery.md`](./disaster-recovery.md). In short:

- RDS automated backups + point-in-time recovery (`db_backup_retention_days`,
  prod 30); Multi-AZ in production.
- ElastiCache holds sessions and queues — treat as recoverable, not the system
  of record. A failover signs users out (they re-authenticate) and re-drives
  unacked jobs.
- The audit log is archived to the versioned S3 bucket (`audit_logs_bucket`
  output) for compliance retention.
