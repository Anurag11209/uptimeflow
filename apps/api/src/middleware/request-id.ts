import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const REQUEST_ID_PATTERN = /^[\w.-]{8,64}$/;

/**
 * Assigns a request id to every request: honors a well-formed inbound
 * X-Request-Id (so ids propagate from Cloudflare / the load balancer),
 * otherwise generates a UUID. Echoed back on the response for support
 * tickets and log correlation.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.headers["x-request-id"];
    const id =
      typeof inbound === "string" && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}
