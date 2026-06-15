import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { createEmailProcessor, renderEmail, type EmailJob } from "../src/index.js";

const inviteJob: EmailJob = {
  template: "org_invitation",
  to: "ada@example.com",
  inviterName: "Grace <Hopper>",
  organizationName: "Acme Status",
  role: "admin",
  acceptUrl: "https://app.backenduptime.dev/invitations/abc123",
};

describe("renderEmail", () => {
  it("renders the invitation with escaped names and the accept link", () => {
    const out = renderEmail(inviteJob);
    expect(out.subject).toContain("Acme Status");
    expect(out.html).toContain("Grace &lt;Hopper&gt;");
    expect(out.html).toContain(inviteJob.acceptUrl);
    expect(out.text).toContain(inviteJob.acceptUrl);
  });

  it("renders every template without throwing", () => {
    const jobs: EmailJob[] = [
      { template: "verify_email", to: "a@b.co", userName: "Ada", verifyUrl: "https://x/v" },
      { template: "reset_password", to: "a@b.co", userName: "Ada", resetUrl: "https://x/r" },
      inviteJob,
      { template: "welcome", to: "a@b.co", userName: "Ada", dashboardUrl: "https://x/d" },
      { template: "alert", to: "a@b.co", monitorName: "API", status: "DOWN", organizationName: "Acme", timestamp: "2026-06-15T00:00:00Z", ctaUrl: "https://x/m" },
      { template: "incident", to: "a@b.co", incidentTitle: "API outage", severity: "MAJOR", description: "connect refused", statusPageUrl: "https://x/s" },
      { template: "status_page_update", to: "a@b.co", pageName: "Status", incidentTitle: "Outage", statusChange: "MONITORING", publicUrl: "https://x/p" },
    ];
    for (const job of jobs) {
      const rendered = renderEmail(job);
      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.html).toContain("Backend Uptime");
      expect(rendered.text.length).toBeGreaterThan(0);
    }
  });

  it("includes alert and incident specifics with a CTA link", () => {
    const alert = renderEmail({
      template: "alert",
      to: "a@b.co",
      monitorName: "Checkout API",
      status: "DOWN",
      organizationName: "Acme",
      timestamp: "2026-06-15T00:00:00Z",
      ctaUrl: "https://app/monitors/m1",
    });
    expect(alert.subject).toBe("[DOWN] Checkout API");
    expect(alert.html).toContain("https://app/monitors/m1");

    const incident = renderEmail({
      template: "incident",
      to: "a@b.co",
      incidentTitle: "Checkout down",
      severity: "CRITICAL",
      description: "5xx spike",
      statusPageUrl: "https://status/p",
    });
    expect(incident.subject).toContain("CRITICAL");
    expect(incident.html).toContain("https://status/p");
  });
});

function fakeJob(data: EmailJob): Job<EmailJob> {
  return { id: "job_1", data, attemptsMade: 0 } as unknown as Job<EmailJob>;
}

describe("createEmailProcessor", () => {
  it("renders, sends, and reports the provider message id", async () => {
    const sender = { send: vi.fn().mockResolvedValue({ providerMessageId: "msg_42" }) };
    const processor = createEmailProcessor({ sender });

    const result = await processor(fakeJob(inviteJob));

    expect(result).toEqual({ template: "org_invitation", providerMessageId: "msg_42" });
    expect(sender.send).toHaveBeenCalledOnce();
    expect(sender.send.mock.calls[0]?.[0]).toMatchObject({ to: "ada@example.com" });
  });

  it("rethrows delivery failures so BullMQ retries with backoff", async () => {
    const sender = { send: vi.fn().mockRejectedValue(new Error("smtp 451")) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const processor = createEmailProcessor({ sender, logger });

    await expect(processor(fakeJob(inviteJob))).rejects.toThrow("smtp 451");
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
