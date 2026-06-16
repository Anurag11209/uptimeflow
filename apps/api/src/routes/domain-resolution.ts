import { Router } from "express";
import type { CustomDomainService } from "../services/custom-domain.service.js";

export interface DomainResolutionDeps {
  service: CustomDomainService;
}

/**
 * Unauthenticated edge endpoints that resolve an inbound hostname to a status
 * page. Two consumers, both keyed off CustomDomainService.resolve():
 *
 *   • GET /v1/internal/tls/authorize?domain=<host>
 *       The Caddy on-demand-TLS "ask" endpoint. Caddy calls it before issuing a
 *       Let's Encrypt cert for an SNI it hasn't seen; we return 200 only for a
 *       VERIFIED domain, so unverified/unknown hosts can't trigger cert
 *       issuance (prevents Let's Encrypt rate-limit abuse). In production this
 *       is network-restricted to the edge.
 *
 *   • GET /v1/public/status-pages/resolve?host=<host>
 *       Used by the public status-page renderer (deferred) to map a custom
 *       hostname to its status page / org. 404 for unverified/unknown.
 *
 * Mounted before auth + the rate limiter: Caddy may hit the authorize endpoint
 * once per TLS handshake, and neither carries tenant credentials (the hostname
 * IS the lookup key).
 */
export function domainResolutionRouter(deps: DomainResolutionDeps): Router {
  const router = Router();

  router.get("/v1/internal/tls/authorize", async (req, res) => {
    const domain = typeof req.query.domain === "string" ? req.query.domain : "";
    const resolved = domain ? await deps.service.resolve(domain) : null;
    if (!resolved) {
      // Non-2xx → Caddy refuses to issue a certificate for this hostname.
      res.status(403).json({ authorized: false });
      return;
    }
    res.status(200).json({ authorized: true });
  });

  router.get("/v1/public/status-pages/resolve", async (req, res) => {
    const host = typeof req.query.host === "string" ? req.query.host : "";
    const resolved = host ? await deps.service.resolve(host) : null;
    if (!resolved) {
      res.status(404).json({ error: { code: "not_found", message: "Unknown or unverified domain." } });
      return;
    }
    res.status(200).json({
      organizationId: resolved.organizationId,
      statusPageId: resolved.statusPageId,
      domain: resolved.domain,
    });
  });

  return router;
}
