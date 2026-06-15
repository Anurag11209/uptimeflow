import { describe, expect, it, vi } from "vitest";
import type { EmailConfig } from "@backend-uptime/config/email";
import {
  classifyEmailError,
  createEmailProcessor,
  emailSenderFromProvider,
  renderEmail,
  SesEmailProvider,
  withRetry,
  type EmailMetrics,
  type SesClientLike,
} from "../src/index.js";

const config: EmailConfig = {
  region: "us-east-1",
  from: "alerts@uptimeflow.in",
  maxRetries: 3,
  hasStaticCredentials: true,
};

function awsError(name: string, statusCode?: number): Error {
  const err = new Error(`${name} occurred`) as Error & { name: string; $metadata?: { httpStatusCode?: number } };
  err.name = name;
  if (statusCode) err.$metadata = { httpStatusCode: statusCode };
  return err;
}

function spyMetrics(): { metrics: EmailMetrics; calls: Record<string, number> } {
  const calls = { sent: 0, failed: 0, retry: 0, duration: 0 };
  return {
    calls,
    metrics: {
      incSent: () => void calls.sent++,
      incFailed: () => void calls.failed++,
      incRetry: () => void calls.retry++,
      observeDuration: () => void calls.duration++,
    },
  };
}

const message = { to: "ops@acme.test", subject: "Down", html: "<p>down</p>", text: "down", template: "alert" };
const noSleep = { sleep: async () => {} };

describe("classifyEmailError", () => {
  it("marks throttling and 5xx as retryable, rejections and auth as not", () => {
    expect(classifyEmailError(awsError("ThrottlingException"))).toMatchObject({ kind: "rate_limit", retryable: true });
    expect(classifyEmailError(awsError("InternalFailure", 500))).toMatchObject({ kind: "server", retryable: true });
    expect(classifyEmailError(awsError("MessageRejected"))).toMatchObject({ kind: "invalid_recipient", retryable: false });
    expect(classifyEmailError(awsError("AccessDeniedException"))).toMatchObject({ kind: "auth", retryable: false });
  });
});

describe("withRetry", () => {
  it("retries retryable errors then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw awsError("ThrottlingException");
        return "ok";
      },
      { maxAttempts: 3, ...noSleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw awsError("MessageRejected");
        },
        { maxAttempts: 3, ...noSleep },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("SesEmailProvider", () => {
  function provider(client: SesClientLike, metrics?: EmailMetrics, sleep = async () => {}) {
    // Patch the retry sleep via a tiny client wrapper isn't needed; backoff uses
    // setTimeout but tests keep maxRetries small and stub throttling rarely.
    void sleep;
    return new SesEmailProvider({ client, config, metrics });
  }

  it("sends HTML+text and returns the SES MessageId", async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-123" });
    const { metrics, calls } = spyMetrics();
    const result = await provider({ sendEmail: send, getAccount: vi.fn() }, metrics).sendEmail(message);

    expect(result).toEqual({ messageId: "ses-123", provider: "ses" });
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      FromEmailAddress: "alerts@uptimeflow.in",
      Destination: { ToAddresses: ["ops@acme.test"] },
    });
    expect(send.mock.calls[0]?.[0].Content.Simple.Body.Html.Data).toBe("<p>down</p>");
    expect(calls.sent).toBe(1);
    expect(calls.duration).toBe(1);
  });

  it("records a failure metric and rethrows on a non-retryable error", async () => {
    const send = vi.fn().mockRejectedValue(awsError("MessageRejected"));
    const { metrics, calls } = spyMetrics();
    await expect(provider({ sendEmail: send, getAccount: vi.fn() }, metrics).sendEmail(message)).rejects.toThrow();
    expect(calls.failed).toBe(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it("reports healthy when SES sending is enabled", async () => {
    const getAccount = vi.fn().mockResolvedValue({ SendingEnabled: true });
    const health = await provider({ sendEmail: vi.fn(), getAccount }).healthCheck();
    expect(health).toMatchObject({ provider: "ses", status: "healthy", region: "us-east-1" });
  });

  it("reports unhealthy when the account call fails", async () => {
    const getAccount = vi.fn().mockRejectedValue(awsError("AccessDeniedException"));
    const health = await provider({ sendEmail: vi.fn(), getAccount }).healthCheck();
    expect(health.status).toBe("unhealthy");
    expect(health.region).toBe("us-east-1");
  });

  it("sendBulkEmail continues past per-message failures", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ MessageId: "a" })
      .mockRejectedValueOnce(awsError("MessageRejected"))
      .mockResolvedValueOnce({ MessageId: "c" });
    const result = await new SesEmailProvider({
      client: { sendEmail: send, getAccount: vi.fn() },
      config,
      sendsPerSecond: 1000,
    }).sendBulkEmail([message, message, message]);
    expect(result).toMatchObject({ sent: 2, failed: 1 });
    expect(result.results).toHaveLength(3);
  });
});

describe("notification pipeline → email provider (integration)", () => {
  it("renders a job and delivers it through the provider-backed sender", async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-int" });
    const sender = emailSenderFromProvider(
      new SesEmailProvider({ client: { sendEmail: send, getAccount: vi.fn() }, config }),
    );
    const processor = createEmailProcessor({ sender });

    const rendered = renderEmail({ template: "verify_email", to: "ada@x.test", userName: "Ada", verifyUrl: "https://x/v" });
    const result = await processor({
      id: "j1",
      data: { template: "verify_email", to: "ada@x.test", userName: "Ada", verifyUrl: "https://x/v" },
      attemptsMade: 0,
    } as never);

    expect(result).toEqual({ template: "verify_email", providerMessageId: "ses-int" });
    // The SES input carries the rendered subject/body.
    expect(send.mock.calls[0]?.[0].Content.Simple.Subject.Data).toBe(rendered.subject);
  });
});
