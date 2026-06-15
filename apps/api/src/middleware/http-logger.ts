import type { IncomingMessage } from "node:http";
import { pinoHttp } from "pino-http";
import type { RequestHandler } from "express";
import type { Logger } from "../telemetry.js";

const QUIET_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

export function httpLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req) => (req as IncomingMessage & { requestId?: string }).requestId ?? "unknown",
    autoLogging: {
      ignore: (req) => QUIET_PATHS.has((req.url ?? "").split("?")[0] ?? ""),
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  }) as unknown as RequestHandler;
}
