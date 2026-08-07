import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createSecureLookup, validateUrl } from "@backend-uptime/notifications";
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
  /** Owning tenant — transports that resolve related rows MUST scope by it. */
  organizationId: string;
  type: AlertChannelType;
  name: string;
  config: unknown;
}

/** Sends one alert over a channel. Throws to trigger a delivery retry. */
export type AlertTransport = (
  channel: AlertChannelView,
  payload: AlertPayload,
) => Promise<{ providerMessageId: string | null }>;

/** Real outbound webhook: POST the alert payload as JSON. */
export const webhookTransport: AlertTransport = (channel, payload) => {
  const config = (channel.config ?? {}) as { url?: string };
  if (!config.url) throw new Error("webhook channel is missing a url");
  // SSRF guard: reject non-http(s)/credentialed/literal-private URLs up front.
  const target = validateUrl(config.url);
  const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = requestFn(
      target,
      {
        method: "POST",
        timeout: 10_000,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        // Validate + pin the resolved IP at connect time (rebinding-proof).
        lookup: createSecureLookup(),
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
