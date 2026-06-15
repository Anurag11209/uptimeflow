import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../src/env.js";

describe("worker env", () => {
  it("applies local-dev defaults", () => {
    const env = parseEnv({});
    expect(env.EMAIL_PROVIDER).toBe("smtp");
    expect(env.SMTP_URL).toBe("smtp://localhost:1025");
    expect(env.WORKER_CONCURRENCY).toBe(10);
  });

  it("exits when resend is selected without an api key", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseEnv({ EMAIL_PROVIDER: "resend" })).toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);

    exit.mockRestore();
    error.mockRestore();
  });

  it("coerces numeric concurrency from strings", () => {
    const env = parseEnv({ WORKER_CONCURRENCY: "25" });
    expect(env.WORKER_CONCURRENCY).toBe(25);
  });
});
