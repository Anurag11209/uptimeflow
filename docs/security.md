# Security Notes (Phase 1)

How the Phase 1 surface maps to the OWASP Top 10 (2021), plus operational
practices. This is a living document — later phases extend it as monitors,
billing, and the public API land.

## OWASP Top 10 mapping

**A01 Broken Access Control.** RBAC is enforced server-side in
`requirePermission` middleware against a single shared matrix; the web UI only
*mirrors* it for convenience. Org membership is resolved per request from the
database, and non-members receive 404 (not 403) to avoid existence leaks.
`assignableRoles` prevents privilege escalation through delegation (e.g. an
admin cannot mint an owner).

**A02 Cryptographic Failures.** Passwords are scrypt-hashed by Better Auth —
never stored or logged in plaintext. Sessions are opaque tokens in
`httpOnly`, `Secure`, `SameSite` cookies. TLS terminates at Cloudflare/the
load balancer. Secrets come from the environment (SSM in production), never
the repo.

**A03 Injection.** All database access goes through Prisma's parameterized
queries. Every request body, query, and param is validated with zod before it
reaches a handler; the readonly `req.query` getter in Express 5 is handled by
storing parsed values on `req.validated`.

**A04 Insecure Design.** Queue-first side effects, stateless API, existence
privacy, and a least-privilege role model are designed in, not bolted on.
Email enumeration is mitigated: forgot-password always returns success.

**A05 Security Misconfiguration.** `helmet` sets security headers;
`x-powered-by` is disabled; CORS is an explicit allowlist with credentials;
the body parser is capped at 1 MB. The metrics endpoint is bearer-guarded in
production (enforced at config parse time).

**A06 Vulnerable Components.** Pinned dependency ranges; CI runs on every PR.
Run `pnpm audit` in the pipeline and keep Better Auth current — its client API
evolves across minor versions.

**A07 Identification & Authentication Failures.** 12-character minimum
passwords, mandatory email verification before first sign-in, optional TOTP
2FA with single-use backup codes, and Redis-backed rate limiting on auth
endpoints (100 requests / 60 s) blunt credential stuffing.

**A08 Software & Data Integrity Failures.** Container images build from pinned
base images in multi-stage Dockerfiles and run as non-root. CI uses OIDC
federation into AWS rather than long-lived keys.

**A09 Logging & Monitoring Failures.** Structured logs carry a request id;
security-relevant events (sign-up, sign-in, password reset, invitations, org
creation) are written to an immutable audit log. The audit sink is wrapped so
a logging failure never blocks the auth path.

**A10 SSRF.** Phase 1 makes no user-controlled outbound requests. This becomes
material in Phase 2 (monitors fetch user-supplied URLs) — the probe layer will
need egress allowlists, IP-range blocking for link-local/metadata endpoints,
and redirect limits.

## Operational practices

- Rotate `BETTER_AUTH_SECRET` and `METRICS_TOKEN` per environment; never reuse
  the development defaults from `docker-compose.yml` in production.
- Run Postgres with TLS and least-privilege credentials; restrict Redis to the
  private network (it holds sessions).
- Set short, sensible CORS origins per environment via `CORS_ORIGINS`.
- Treat the audit log as append-only; ship it to durable storage.
