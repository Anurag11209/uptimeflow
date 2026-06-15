import { z } from "zod";
import type { Request } from "express";
import type { IntegrationActor } from "../../services/integration.service.js";

export const nameSchema = z.string().trim().min(1).max(120);

/** Mask a secret URL/token for read responses — only a short suffix is shown. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `••••${value.slice(-6)}`;
}

export function actorOf(req: Request): IntegrationActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}
