import express, { Router, type Express } from "express";
import { toNodeHandler } from "better-auth/node";
import type { PrismaClient } from "@backend-uptime/db";
import type { AuthHandler, GetSession } from "./context.js";
import type { Env } from "./env.js";
import { authenticate } from "./middleware/authenticate.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { httpLogger } from "./middleware/http-logger.js";
import { rateLimit, type RateLimiterLike } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import { requireSession } from "./middleware/require-session.js";
import { corsPolicy, securityHeaders } from "./middleware/security.js";
import { LoggingEmailProvider, type EmailProvider } from "@backend-uptime/notifications";
import { apiKeysRouter } from "./routes/api-keys.js";
import { emailHealthRouter } from "./routes/email-health.js";
import { escalationPoliciesRouter } from "./routes/escalation-policies.js";
import { healthRouter } from "./routes/health.js";
import { heartbeatsRouter } from "./routes/heartbeats.js";
import { incidentsRouter } from "./routes/incidents.js";
import { meRouter } from "./routes/me.js";
import { metricsRouter } from "./routes/metrics.js";
import { onCallSchedulesRouter } from "./routes/oncall-schedules.js";
import { organizationsRouter } from "./routes/organizations.js";
import { createApiKeyService, type ApiKeyService } from "./services/api-key.service.js";
import { createAuditLogService, type AuditLogService } from "./services/audit-log.service.js";
import {
  createEscalationPolicyService,
  type EscalationPolicyService,
} from "./services/escalation-policy.service.js";
import { createIncidentService, type IncidentService } from "./services/incident.service.js";
import { createMemberService, type MemberService } from "./services/member.service.js";
import { createOnCallScheduleService, type OnCallScheduleService } from "./services/oncall.service.js";
import { createOrgStatsService, type OrgStatsService } from "./services/org-stats.service.js";
import { metricsMiddleware, type Logger, type Metrics } from "./telemetry.js";

export interface ServerServices {
  members: MemberService;
  auditLogs: AuditLogService;
  orgStats: OrgStatsService;
  apiKeys: ApiKeyService;
  incidents: IncidentService;
  escalationPolicies: EscalationPolicyService;
  onCallSchedules: OnCallScheduleService;
}

export interface ServerDeps {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  redis: { ping(): Promise<string> };
  /** Fetch-style handler from Better Auth (auth.handler). */
  authHandler: AuthHandler;
  /** Wrapped auth.api.getSession. */
  getSession: GetSession;
  metrics: Metrics;
  rateLimiter: RateLimiterLike | null;
  /** Email provider for the internal email health endpoint (defaults to logging). */
  emailProvider?: EmailProvider;
  /** Override services in tests; defaults are built from prisma. */
  services?: Partial<ServerServices>;
}

export function createServer(deps: ServerDeps): Express {
  const auditLogs =
    deps.services?.auditLogs ?? createAuditLogService({ prisma: deps.prisma, logger: deps.logger });
  const services: ServerServices = {
    members: deps.services?.members ?? createMemberService({ prisma: deps.prisma }),
    auditLogs,
    orgStats: deps.services?.orgStats ?? createOrgStatsService({ prisma: deps.prisma }),
    apiKeys: deps.services?.apiKeys ?? createApiKeyService({ prisma: deps.prisma }),
    incidents: deps.services?.incidents ?? createIncidentService({ prisma: deps.prisma, auditLogs }),
    escalationPolicies:
      deps.services?.escalationPolicies ??
      createEscalationPolicyService({ prisma: deps.prisma, auditLogs }),
    onCallSchedules:
      deps.services?.onCallSchedules ??
      createOnCallScheduleService({ prisma: deps.prisma, auditLogs }),
  };

  const app = express();

  app.disable("x-powered-by");
  // Cloudflare + ALB sit in front in production; req.ip must reflect the client.
  app.set("trust proxy", true);

  app.use(requestId());
  app.use(httpLogger(deps.logger));
  app.use(metricsMiddleware(deps.metrics));
  app.use(securityHeaders());
  app.use(corsPolicy(deps.env));

  // Better Auth owns /api/auth/* and parses its own request bodies.
  // It MUST be mounted before express.json() — a consumed body stream
  // breaks Better Auth's handler.
  app.all("/api/auth/{*any}", toNodeHandler(deps.authHandler));

  app.use(express.json({ limit: "1mb" }));

  // Unauthenticated infrastructure endpoints (not rate limited).
  app.use(healthRouter({ prisma: deps.prisma, redis: deps.redis }));
  app.use(metricsRouter({ registry: deps.metrics.registry, env: deps.env }));
  app.use(emailHealthRouter({ emailProvider: deps.emailProvider ?? new LoggingEmailProvider(deps.logger) }));

  // Versioned REST surface.
  const v1 = Router();
  v1.use(rateLimit(deps.rateLimiter));

  // Unified principal resolution: session cookie OR API key.
  const authn = authenticate({ getSession: deps.getSession, apiKeys: services.apiKeys });

  // Heartbeat ingest is unauthenticated (the monitor UUID is the secret); it is
  // still rate limited via the v1 limiter above.
  v1.use("/heartbeats", heartbeatsRouter({ prisma: deps.prisma }));

  // /me is about the signed-in human, so it stays cookie-session only.
  v1.use("/me", requireSession(deps.getSession), meRouter({ prisma: deps.prisma }));

  // Mounted before the general org router so the more specific prefix wins.
  v1.use(
    "/organizations/:organizationId/api-keys",
    authn,
    apiKeysRouter({ prisma: deps.prisma, apiKeys: services.apiKeys }),
  );
  v1.use(
    "/organizations/:organizationId/incidents",
    authn,
    incidentsRouter({ prisma: deps.prisma, incidents: services.incidents }),
  );
  v1.use(
    "/organizations/:organizationId/escalation-policies",
    authn,
    escalationPoliciesRouter({ prisma: deps.prisma, escalationPolicies: services.escalationPolicies }),
  );
  v1.use(
    "/organizations/:organizationId/oncall-schedules",
    authn,
    onCallSchedulesRouter({ prisma: deps.prisma, onCallSchedules: services.onCallSchedules }),
  );
  v1.use(
    "/organizations/:organizationId",
    authn,
    organizationsRouter({ prisma: deps.prisma, ...services }),
  );
  app.use("/v1", v1);

  app.use(notFoundHandler());
  app.use(errorHandler(deps.logger));

  return app;
}
