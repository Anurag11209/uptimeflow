import { connect as tlsConnect } from "node:tls";
import type { CertInfo, Probe, ProbeSignal } from "../types.js";
import { certName } from "./http.js";

const DEFAULT_TLS_PORT = 443;

/**
 * SSL probe. Opens a TLS connection (SNI set) and reports the peer
 * certificate's expiry. Reachability is the handshake; the actual
 * expired/near-expiry classification happens in `evaluateValidations`, which
 * turns `cert.daysUntilExpiry` into DOWN (expired) or DEGRADED (near expiry).
 */
export const sslProbe: Probe = async (monitor, ctx) => {
  const host = monitor.host ?? (monitor.url ? new URL(monitor.url).hostname : null);
  if (!host) {
    return { reachable: false, responseMs: 0, errorType: "config", errorMessage: "Monitor needs a host or url." };
  }
  const port = monitor.port ?? (monitor.url ? Number(new URL(monitor.url).port) || DEFAULT_TLS_PORT : DEFAULT_TLS_PORT);
  const started = performance.now();

  return new Promise<ProbeSignal>((resolve) => {
    let settled = false;
    const socket = tlsConnect({
      host,
      port,
      servername: host,
      // Always complete the handshake so we can read the cert; verification is
      // reported separately rather than hard-failing the connection.
      rejectUnauthorized: false,
      timeout: monitor.timeoutSeconds * 1000,
    });

    const done = (signal: ProbeSignal): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      ctx.signal.removeEventListener("abort", onAbort);
      resolve(signal);
    };
    const fail = (errorType: string, message: string): void =>
      done({ reachable: false, responseMs: Math.round(performance.now() - started), errorType, errorMessage: message });

    const onAbort = (): void => fail("timeout", "TLS connection aborted.");
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    socket.once("secureConnect", () => {
      const peer = socket.getPeerCertificate();
      if (!peer || !peer.valid_to) {
        fail("tls", "No peer certificate presented.");
        return;
      }
      const validTo = new Date(peer.valid_to);
      const cert: CertInfo = {
        validTo,
        validFrom: new Date(peer.valid_from),
        daysUntilExpiry: Math.floor((validTo.getTime() - ctx.now.getTime()) / 86_400_000),
        issuer: certName(peer.issuer?.O) ?? certName(peer.issuer?.CN),
        subject: certName(peer.subject?.CN),
      };
      done({ reachable: true, responseMs: Math.round(performance.now() - started), cert });
    });
    socket.once("timeout", () => fail("timeout", "TLS handshake timed out."));
    socket.once("error", (err: NodeJS.ErrnoException) => {
      const type = err.code === "ECONNREFUSED" ? "refused" : err.code === "ENOTFOUND" ? "dns" : "tls";
      fail(type, err.message);
    });
  });
};
