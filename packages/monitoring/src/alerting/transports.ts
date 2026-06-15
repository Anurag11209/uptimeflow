import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AlertChannelType } from "@backend-uptime/db";

export interface AlertPayload {
  kind: "opened" | "resolved";
  incidentId: string;
  monitorName: string;
  title: string;
  severity: string | null;
  summary: string | null;
  occurredAt: string;
}

export interface AlertChannelView {
  id: string;
  type: AlertChannelType;
  name: string;
  config: unknown;
}

/** Sends one alert over a channel. Throws to trigger a delivery retry. */
export type AlertTransport = (
  channel: AlertChannelView,
  payload: AlertPayload,
) => Promise<{ providerMessageId: string | null }>;

export interface TransportLogger {
  info(payload: Record<string, unknown>, message: string): void;
}

/** Real outbound webhook: POST the alert payload as JSON. */
export const webhookTransport: AlertTransport = (channel, payload) => {
  const config = (channel.config ?? {}) as { url?: string };
  if (!config.url) throw new Error("webhook channel is missing a url");
  const target = new URL(config.url);
  const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = requestFn(
      target,
      {
        method: "POST",
        timeout: 10_000,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume(); // drain
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve({ providerMessageId: res.headers["x-message-id"]?.toString() ?? null });
        else reject(new Error(`webhook responded ${status}`));
      },
    );
    req.on("timeout", () => req.destroy(new Error("webhook timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

/**
 * Fallback transport for channel types without a provider integration yet
 * (EMAIL/SMS/Slack/…). It records the alert as delivered after logging it, so
 * the end-to-end pipeline is exercised; real providers are added per channel in
 * later phases (architecture Phase 5).
 */
export function loggingTransport(logger?: TransportLogger): AlertTransport {
  return async (channel, payload) => {
    logger?.info(
      { channelType: channel.type, channelName: channel.name, kind: payload.kind, incidentId: payload.incidentId },
      "alert delivered (logging transport — no provider integration)",
    );
    return { providerMessageId: null };
  };
}
