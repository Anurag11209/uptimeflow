import { describe, expect, it } from "vitest";
import { deliveryStatusMeta, lastDeliveryFor, type IntegrationDelivery } from "../lib/integrations";

function delivery(over: Partial<IntegrationDelivery>): IntegrationDelivery {
  return {
    id: "d1",
    integrationType: "SLACK",
    integrationId: "i1",
    event: "incident.opened",
    status: "SUCCESS",
    attempts: 1,
    responseStatus: 200,
    error: null,
    sentAt: "2026-06-17T00:00:00Z",
    createdAt: "2026-06-17T00:00:00Z",
    ...over,
  };
}

describe("deliveryStatusMeta", () => {
  it("maps statuses to label + tone", () => {
    expect(deliveryStatusMeta("SUCCESS")).toMatchObject({ label: "Delivered", tone: "up" });
    expect(deliveryStatusMeta("DEAD")).toMatchObject({ label: "Dead-lettered", tone: "down" });
    expect(deliveryStatusMeta("FAILED").tone).toBe("brand");
    expect(deliveryStatusMeta("PENDING").tone).toBe("muted");
  });
});

describe("lastDeliveryFor", () => {
  it("returns the first matching delivery (list is newest-first)", () => {
    const list = [
      delivery({ id: "d2", integrationId: "i1", createdAt: "2026-06-17T01:00:00Z" }),
      delivery({ id: "d1", integrationId: "i1", createdAt: "2026-06-17T00:00:00Z" }),
      delivery({ id: "d3", integrationId: "i2" }),
    ];
    expect(lastDeliveryFor(list, "i1")?.id).toBe("d2");
    expect(lastDeliveryFor(list, "i2")?.id).toBe("d3");
    expect(lastDeliveryFor(list, "nope")).toBeNull();
  });
});
