"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";

export type IntegrationProvider = "slack" | "discord" | "webhooks";
export type IntegrationType = "SLACK" | "DISCORD" | "WEBHOOK";
export type DeliveryStatus = "PENDING" | "SENDING" | "SUCCESS" | "FAILED" | "DEAD";

export interface ChatIntegration {
  id: string;
  name: string;
  webhookUrlPreview: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookIntegration {
  id: string;
  name: string;
  endpoint: string;
  secretPreview: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationDelivery {
  id: string;
  integrationType: IntegrationType;
  integrationId: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export const integrationKeys = {
  list: (orgId: string, provider: IntegrationProvider) => ["org", orgId, "integrations", provider] as const,
  deliveries: (orgId: string) => ["org", orgId, "integration-deliveries"] as const,
};

function base(orgId: string, provider: IntegrationProvider): string {
  return `/v1/organizations/${orgId}/integrations/${provider}`;
}

export function useChatIntegrations(
  orgId: string | undefined,
  provider: "slack" | "discord",
  enabled = true,
) {
  return useQuery({
    queryKey: integrationKeys.list(orgId ?? "none", provider),
    queryFn: () => api<Page<ChatIntegration>>(`${base(orgId!, provider)}?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useWebhookIntegrations(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: integrationKeys.list(orgId ?? "none", "webhooks"),
    queryFn: () => api<Page<WebhookIntegration>>(`${base(orgId!, "webhooks")}?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useIntegrationDeliveries(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: integrationKeys.deliveries(orgId ?? "none"),
    queryFn: () =>
      api<Page<IntegrationDelivery>>(`/v1/organizations/${orgId}/integrations/deliveries?limit=50`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useInvalidateIntegrations() {
  const queryClient = useQueryClient();
  return (orgId: string) =>
    void queryClient.invalidateQueries({ queryKey: ["org", orgId, "integrations"] });
}

export interface DeliveryStatusMeta {
  label: string;
  tone: "up" | "down" | "muted" | "brand";
}

/** Map a delivery status to a display label + badge tone (pure, tested). */
export function deliveryStatusMeta(status: DeliveryStatus): DeliveryStatusMeta {
  switch (status) {
    case "SUCCESS":
      return { label: "Delivered", tone: "up" };
    case "FAILED":
      return { label: "Failed", tone: "brand" };
    case "DEAD":
      return { label: "Dead-lettered", tone: "down" };
    case "SENDING":
      return { label: "Sending", tone: "muted" };
    case "PENDING":
    default:
      return { label: "Pending", tone: "muted" };
  }
}

/** The most recent delivery for an integration, from a delivery list. */
export function lastDeliveryFor(
  deliveries: IntegrationDelivery[],
  integrationId: string,
): IntegrationDelivery | null {
  return deliveries.find((d) => d.integrationId === integrationId) ?? null;
}
