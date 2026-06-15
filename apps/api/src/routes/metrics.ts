import { Router } from "express";
import type { Registry } from "prom-client";
import type { Env } from "../env.js";

/**
 * Prometheus scrape endpoint. In production a bearer token is required
 * (env enforces METRICS_TOKEN is set); locally it is open for convenience.
 */
export function metricsRouter(deps: {
  registry: Registry;
  env: Pick<Env, "METRICS_TOKEN" | "isProduction">;
}): Router {
  const router = Router();

  router.get("/metrics", async (req, res) => {
    const token = deps.env.METRICS_TOKEN;
    if (token) {
      const header = req.headers.authorization ?? "";
      if (header !== `Bearer ${token}`) {
        res.status(401).json({ error: { code: "unauthorized", message: "Invalid metrics token." } });
        return;
      }
    }
    res.setHeader("Content-Type", deps.registry.contentType);
    res.send(await deps.registry.metrics());
  });

  return router;
}
