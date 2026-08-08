import { describe, expect, it } from "vitest";
import type { EmailQueue } from "@backend-uptime/notifications";
import type { ResponderPage } from "@backend-uptime/monitoring";
import { emailResponderNotifier } from "../src/responder-notifier.js";

/**
 * A page must be a genuine queued email, not a log line — the whole point of
 * Phase 2. These assert the job that reaches the shared email queue, which the
 * worker drains with the real SMTP/SES sender.
 */
function mockQueue() {
  const added: Array<{ name: string; data: Record<string, unknown>; opts?: { jobId?: string } }> = [];
  const queue = {
    add: async (name: string, data: Record<string, unknown>, opts?: { jobId?: string }) => {
      added.push({ name, data, opts });
      return { id: opts?.jobId ?? "job_1" };
    },
  } as unknown as EmailQueue;
  return { queue, added };
}

const page: ResponderPage = {
  incidentId: "inc_1",
  organizationId: "org_1",
  userId: "u_alice",
  email: "alice@example.com",
  userName: "Alice",
  via: "schedule:rotation",
  step: 2,
  incidentTitle: "Acme API is down",
  severity: "MAJOR",
  summary: "connect ECONNREFUSED",
  monitorName: "Acme API",
};

describe("emailResponderNotifier", () => {
  it("enqueues an incident email addressed to the responder", async () => {
    const { queue, added } = mockQueue();

    await emailResponderNotifier({ queue, webUrl: "https://app.test" }).page(page);

    expect(added).toHaveLength(1);
    expect(added[0]!.name).toBe("incident");
    expect(added[0]!.data).toMatchObject({
      template: "incident",
      to: "alice@example.com",
      incidentTitle: "Acme API is down",
      severity: "MAJOR",
      description: "connect ECONNREFUSED",
      statusPageUrl: "https://app.test/dashboard/incidents/inc_1",
    });
  });

  // The escalation queue retries a failed job up to 3 times and a step pages
  // several people at once, so without a deterministic id one bad address would
  // re-mail everyone the step already reached.
  it("uses a dedupe key of (incident, step, user)", async () => {
    const { queue, added } = mockQueue();
    await emailResponderNotifier({ queue, webUrl: "https://app.test" }).page(page);
    expect(added[0]!.opts?.jobId).toBe("escalation-page:inc_1:2:u_alice");
  });

  it("gives different steps distinct keys so a later step still pages", async () => {
    const { queue, added } = mockQueue();
    const notifier = emailResponderNotifier({ queue, webUrl: "https://app.test" });
    await notifier.page(page);
    await notifier.page({ ...page, step: 3 });
    expect(added.map((a) => a.opts?.jobId)).toEqual([
      "escalation-page:inc_1:2:u_alice",
      "escalation-page:inc_1:3:u_alice",
    ]);
  });

  it("falls back to a readable body when the incident has no summary", async () => {
    const { queue, added } = mockQueue();
    await emailResponderNotifier({ queue, webUrl: "https://app.test" }).page({ ...page, summary: null });
    expect(added[0]!.data.description).toContain("Acme API");
    expect(added[0]!.data.description).toContain("escalation path");
  });

  it("reports unknown severity rather than omitting it", async () => {
    const { queue, added } = mockQueue();
    await emailResponderNotifier({ queue, webUrl: "https://app.test" }).page({ ...page, severity: null });
    expect(added[0]!.data.severity).toBe("unknown");
  });

  it("trims a trailing slash from webUrl", async () => {
    const { queue, added } = mockQueue();
    await emailResponderNotifier({ queue, webUrl: "https://app.test/" }).page(page);
    expect(added[0]!.data.statusPageUrl).toBe("https://app.test/dashboard/incidents/inc_1");
  });

  it("propagates an enqueue failure so the engine records the page as failed", async () => {
    const queue = { add: async () => { throw new Error("redis down"); } } as unknown as EmailQueue;
    await expect(
      emailResponderNotifier({ queue, webUrl: "https://app.test" }).page(page),
    ).rejects.toThrow(/redis down/);
  });
});
