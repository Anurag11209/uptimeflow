import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { PrismaClient } from "@backend-uptime/db";
import type { EmailJob, EmailQueue } from "@backend-uptime/notifications";
import { createStatusNotifier } from "../src/services/status-notifier.js";

interface Added {
  name: string;
  data: EmailJob;
  opts: { jobId?: string };
}

function fakeQueue(): { queue: EmailQueue; added: Added[] } {
  const added: Added[] = [];
  const queue = {
    add: async (name: string, data: EmailJob, opts: { jobId?: string }) => {
      added.push({ name, data, opts });
      return { id: opts.jobId ?? "x" };
    },
  } as unknown as EmailQueue;
  return { queue, added };
}

function fakePrisma(subscribers: Array<{ id: string; email: string; unsubscribeToken: string | null }>): PrismaClient {
  return {
    statusPageSubscriber: { findMany: async () => subscribers },
  } as unknown as PrismaClient;
}

const logger = pino({ level: "silent" });
const opened = {
  statusPageId: "sp_1",
  pageSlug: "acme",
  pageName: "Acme Status",
  incidentId: "inc_1",
  updateId: "upd_1",
  title: "API degraded",
  phase: "opened" as const,
  statusLabel: "INVESTIGATING",
  body: "Investigating elevated errors.",
};

describe("status notifier", () => {
  it("enqueues a confirmation email keyed on the token", async () => {
    const { queue, added } = fakeQueue();
    const notifier = createStatusNotifier({ prisma: fakePrisma([]), emailQueue: queue, webUrl: "https://app", logger });
    await notifier.sendVerification({
      pageName: "Acme Status",
      email: "fan@example.com",
      confirmUrl: "https://app/status/acme/verify?token=abc123",
    });
    expect(added).toHaveLength(1);
    expect(added[0]!.data.template).toBe("status_subscribe_confirm");
    expect(added[0]!.opts.jobId).toBe("status-confirm:abc123");
  });

  it("fans out an incident to every active subscriber with an idempotent jobId", async () => {
    const { queue, added } = fakeQueue();
    const notifier = createStatusNotifier({
      prisma: fakePrisma([
        { id: "s1", email: "a@example.com", unsubscribeToken: "u1" },
        { id: "s2", email: "b@example.com", unsubscribeToken: "u2" },
      ]),
      emailQueue: queue,
      webUrl: "https://app",
      logger,
    });
    await notifier.notifyIncident(opened);

    expect(added).toHaveLength(2);
    expect(added.map((a) => a.data.template)).toEqual(["status_incident_opened", "status_incident_opened"]);
    expect(added[0]!.opts.jobId).toBe("status-incident:opened:inc_1:upd_1:s1");
    const job = added[0]!.data;
    if (job.template === "status_incident_opened") {
      expect(job.publicUrl).toBe("https://app/status/acme");
      expect(job.unsubscribeUrl).toBe("https://app/status/acme/unsubscribe?token=u1");
    }
  });

  it("maps the resolved phase to the resolved template", async () => {
    const { queue, added } = fakeQueue();
    const notifier = createStatusNotifier({
      prisma: fakePrisma([{ id: "s1", email: "a@example.com", unsubscribeToken: "u1" }]),
      emailQueue: queue,
      webUrl: "https://app",
      logger,
    });
    await notifier.notifyIncident({ ...opened, phase: "resolved", updateId: "upd_2", statusLabel: "RESOLVED" });
    expect(added[0]!.data.template).toBe("status_incident_resolved");
  });

  it("does nothing when there are no active subscribers", async () => {
    const { queue, added } = fakeQueue();
    const notifier = createStatusNotifier({ prisma: fakePrisma([]), emailQueue: queue, webUrl: "https://app", logger });
    await notifier.notifyIncident(opened);
    expect(added).toHaveLength(0);
  });
});
