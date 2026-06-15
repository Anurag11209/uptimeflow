# Backend Uptime

Production-grade uptime monitoring, incident management, on-call alerting, and
status pages — built as a Turborepo monorepo. This repository is delivered in
phases; **Phase 1 (Authentication & Organizations) is implemented here**, with
later phases forward-declared in the data model, RBAC matrix, and UI.

```
Next.js 15 · Express 5 · Prisma · PostgreSQL · Redis · BullMQ · Better Auth
TypeScript (ESM, Node 22) · Tailwind v4 · React Query · Turborepo · pnpm
```

## What Phase 1 ships

- Email/password accounts with **mandatory email verification** (12-char min)
- **Social login** (GitHub, Google) and **TOTP two-factor** with backup codes
- Password reset, all auth emails delivered **via a queue + worker** (retries)
- **Organizations** with five roles — Owner, Admin, Billing Admin, Member,
  Read Only — enforced by a single shared RBAC matrix
- **Member invitations** (7-day expiry, email-matched acceptance), role
  changes, and removal
- **Audit logging** of security-relevant events
- A dark, control-room dashboard: overview stats, member management, and
  security (2FA) settings
- Health/readiness probes, Prometheus metrics, OpenTelemetry tracing,
  structured logging, Redis-backed rate limiting
- Docker images per app, Compose stack, Prometheus + Grafana, and CI

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 15 dashboard + auth flows |
| `apps/api` | Express 5 API + Better Auth handler, `/v1` REST surface |
| `apps/worker` | BullMQ consumer (email delivery) |
| `packages/shared` | RBAC matrix, error envelope, pagination, zod schemas |
| `packages/db` | Prisma schema, client, migrations, seed |
| `packages/auth` | Better Auth wiring + access-control bridge |
| `packages/notifications` | Email templates, sender, queue + processor |
| `packages/config` | Shared tsconfig presets |
| `docs/` | architecture · security · deployment · openapi |

## Quick start

Prerequisites: **Node ≥ 22**, **pnpm 9**, and **Docker** (for Postgres, Redis,
and Mailpit).

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env defaults (works as-is for local dev)
cp .env.example .env

# 3. Start infra (Postgres + Redis + Mailpit email sink)
docker compose up -d postgres redis mailpit

# 4. Apply the schema and seed a demo organization
pnpm db:migrate
pnpm db:seed

# 5. Run everything with hot reload
pnpm dev
```

Then open:

- **Dashboard** → http://localhost:3000
- **API** → http://localhost:4000 (`/healthz`, `/readyz`)
- **Mailpit** (all outgoing emails land here) → http://localhost:8025

Sign up at `/sign-up`, then open Mailpit to click your verification link —
since local email goes to Mailpit, not a real inbox.

> Prefer containers for everything? `docker compose up --build` runs api +
> worker + web too. Add `--profile observability` for Prometheus (:9090) and
> Grafana (:3001).

## Environment

`.env.example` documents every variable. The essentials:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for sessions, rate limiting, queues |
| `BETTER_AUTH_SECRET` | Signing secret — **change in production** |
| `BETTER_AUTH_URL` | Public URL of the API (e.g. http://localhost:4000) |
| `WEB_URL` | Public URL of the web app (used in email links) |
| `CORS_ORIGINS` | Comma-separated allowlist (in addition to `WEB_URL`) |
| `EMAIL_PROVIDER` | `smtp` (Mailpit locally), `resend`, or `ses` (Amazon SES, production) |
| `EMAIL_FROM`, `SMTP_URL` / `RESEND_API_KEY` | Email delivery |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_MAX_RETRIES` | Amazon SES (creds optional — IAM role preferred) |
| `METRICS_TOKEN` | Bearer for `/metrics` — required in production |
| `GITHUB_*`, `GOOGLE_*` | Optional OAuth credentials |
| `NEXT_PUBLIC_API_URL` | API URL inlined into the web build |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Enables tracing when set |

### Email delivery (Amazon SES)

Production uses **Amazon SES** via the AWS SDK v3 (`@aws-sdk/client-sesv2`, no
SMTP). Verify the sending domain (`uptimeflow.in`) in SES `us-east-1`, set
`EMAIL_PROVIDER=ses` and `EMAIL_FROM=alerts@uptimeflow.in`, and grant the worker
`ses:SendEmail` + `ses:GetAccount` (IAM role preferred over static keys). All
transactional, alert, incident, escalation, and status-page emails flow through
the same queue → worker → `SesEmailProvider`. Health: `GET /internal/email/health`.
See [docs/deployment.md](docs/deployment.md#email-amazon-ses).

## Common scripts

| Command | Action |
|---|---|
| `pnpm dev` | Run all apps with hot reload |
| `pnpm build` | Build every package and app |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates |
| `pnpm db:migrate` | Apply migrations (dev) |
| `pnpm db:deploy` | Apply migrations (production, non-interactive) |
| `pnpm db:seed` | Seed the demo organization |
| `pnpm db:generate` | Regenerate the Prisma client |

## Testing

Vitest across packages and apps. The API suite covers the error envelope,
health/readiness, and the full RBAC matrix (each role against members,
invitations, audit logs, and overview) using an in-memory fake Prisma — no
database required. Run `pnpm test`, or `pnpm --filter @backend-uptime/api test`
for one workspace.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system context, sequence
  diagrams, RBAC matrix, ADRs, and the phase roadmap
- [`docs/security.md`](docs/security.md) — OWASP Top 10 mapping
- [`docs/deployment.md`](docs/deployment.md) — Compose + AWS ECS Fargate
- [`docs/openapi.yaml`](docs/openapi.yaml) — the `/v1` REST contract

## Notes & caveats

- **Better Auth** owns auth and organization mutations; the `/v1` surface is
  read-heavy. Its client API surface evolves across `1.2.x` minors — if you
  bump the version, re-check the `authClient.*` calls in `apps/web/lib`.
- **No `pnpm install` has been run in this delivery** — run it yourself so the
  lockfile resolves against your platform. The first `pnpm build` compiles
  workspace packages before the apps that import them.
- Under pure ESM, full OpenTelemetry auto-instrumentation can need a Node
  loader flag depending on instrumentation versions; see
  `docs/deployment.md`.

## Roadmap

Phase 1 ✅ Auth & Organizations · Phase 2 Monitors & engine · Phase 3
Global probe network · Phase 4 Incidents · Phase 5 Alerting & voice · Phase 6
On-call · Phase 7 Status pages · Phase 8 Analytics · Phase 9 Billing,
developer platform, enterprise SSO.
