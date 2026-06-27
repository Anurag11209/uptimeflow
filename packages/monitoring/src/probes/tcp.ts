import { Socket } from "node:net";
import { createSecureLookup } from "@backend-uptime/notifications";
import type { MonitorSnapshot, Probe, ProbeContext, ProbeSignal } from "../types.js";

/** Default L4 reachability port when a ping monitor omits one. */
const DEFAULT_PING_PORT = 443;

function tcpConnect(
  host: string,
  port: number,
  monitor: MonitorSnapshot,
  ctx: ProbeContext,
): Promise<ProbeSignal> {
  const started = performance.now();

  return new Promise<ProbeSignal>((resolve) => {
    const socket = new Socket();
    let settled = false;

    const done = (signal: ProbeSignal): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      ctx.signal.removeEventListener("abort", onAbort);
      resolve(signal);
    };
    const fail = (errorType: string, message: string): void =>
      done({ reachable: false, responseMs: Math.round(performance.now() - started), errorType, errorMessage: message });

    const onAbort = (): void => fail("timeout", "Connection aborted.");
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    socket.setTimeout(monitor.timeoutSeconds * 1000);
    socket.once("connect", () =>
      done({ reachable: true, responseMs: Math.round(performance.now() - started) }),
    );
    socket.once("timeout", () => fail("timeout", "Connection timed out."));
    socket.once("error", (err: NodeJS.ErrnoException) => {
      const type = err.code?.startsWith("ssrf")
        ? "blocked"
        : err.code === "ECONNREFUSED"
          ? "refused"
          : err.code === "ENOTFOUND"
            ? "dns"
            : "connect";
      fail(type, err.message);
    });

    // SSRF guard: validate + pin the resolved IP at connect time.
    socket.connect({ host, port, lookup: createSecureLookup() });
  });
}

/** TCP / PORT probe: success = the TCP handshake completes within the timeout. */
export const tcpProbe: Probe = async (monitor, ctx) => {
  if (!monitor.host || monitor.port == null) {
    return { reachable: false, responseMs: 0, errorType: "config", errorMessage: "Monitor needs host and port." };
  }
  return tcpConnect(monitor.host, monitor.port, monitor, ctx);
};

/**
 * Ping probe. ICMP needs raw-socket privileges, so this performs an L4
 * reachability check (TCP handshake to the host) — privilege-free and a good
 * proxy for "is the host up". Defaults to port 443 when unspecified.
 */
export const pingProbe: Probe = async (monitor, ctx) => {
  if (!monitor.host) {
    return { reachable: false, responseMs: 0, errorType: "config", errorMessage: "Monitor needs a host." };
  }
  return tcpConnect(monitor.host, monitor.port ?? DEFAULT_PING_PORT, monitor, ctx);
};
