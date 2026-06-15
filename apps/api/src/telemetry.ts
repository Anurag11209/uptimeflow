import { pino, type Logger } from "pino";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { RequestHandler } from "express";
import type { Env } from "./env.js";

export type { Logger };

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "OTEL_SERVICE_NAME">): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: env.OTEL_SERVICE_NAME },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
        "*.password",
        "*.token",
        "*.secret",
      ],
      censor: "[redacted]",
    },
  });
}

export interface Metrics {
  registry: Registry;
  httpDuration: Histogram<string>;
  httpTotal: Counter<string>;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request latency in seconds.",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpTotal = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests handled.",
    labelNames: ["method", "route", "status_code"],
    registers: [registry],
  });

  return { registry, httpDuration, httpTotal };
}

/**
 * Records duration + count per (method, route, status). The route label uses
 * the matched Express route pattern, never the raw URL, to keep metric
 * cardinality bounded.
 */
export function metricsMiddleware(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    const end = metrics.httpDuration.startTimer();
    res.on("finish", () => {
      const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : resolveUnmatchedRoute(req.path);
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };
      end(labels);
      metrics.httpTotal.inc(labels);
    });
    next();
  };
}

function resolveUnmatchedRoute(path: string): string {
  // Better Auth routes are mounted as a single fetch handler, so Express never
  // sets req.route for them — bucket them together explicitly.
  if (path.startsWith("/api/auth")) return "/api/auth/*";
  if (path === "/healthz" || path === "/readyz" || path === "/metrics") return path;
  return "unmatched";
}

/**
 * Starts OpenTelemetry tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * Returns a shutdown function (no-op when tracing is disabled).
 *
 * All OTel modules are imported lazily so the SDK is only loaded when tracing
 * is enabled, and so it loads before Express/ioredis when the entrypoint
 * calls this ahead of importing the rest of the app (see src/index.ts).
 */
export async function startTracing(
  env: Pick<Env, "OTEL_EXPORTER_OTLP_ENDPOINT" | "OTEL_SERVICE_NAME">,
  logger: Logger,
): Promise<() => Promise<void>> {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return async () => {};

  try {
    const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }, { ExpressInstrumentation }, { IORedisInstrumentation }] =
      await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/instrumentation-http"),
        import("@opentelemetry/instrumentation-express"),
        import("@opentelemetry/instrumentation-ioredis"),
      ]);

    const sdk = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }),
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req) =>
            req.url === "/healthz" || req.url === "/readyz" || req.url === "/metrics",
        }),
        new ExpressInstrumentation(),
        new IORedisInstrumentation(),
      ],
    });

    sdk.start();
    logger.info({ endpoint }, "opentelemetry tracing started");
    return async () => {
      await sdk.shutdown().catch((err: unknown) => logger.warn({ err }, "otel shutdown failed"));
    };
  } catch (err) {
    logger.warn({ err }, "failed to start opentelemetry tracing — continuing without traces");
    return async () => {};
  }
}
