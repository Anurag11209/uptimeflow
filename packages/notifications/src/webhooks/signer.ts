import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "X-UptimeFlow-Signature";
export const EVENT_HEADER = "X-UptimeFlow-Event";
export const TIMESTAMP_HEADER = "X-UptimeFlow-Timestamp";

/**
 * HMAC-SHA256 over `${timestamp}.${body}` (the timestamp is bound into the
 * signature so a captured payload cannot be replayed with a new time). Returns
 * `sha256=<hex>`, the value of the X-UptimeFlow-Signature header.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${mac}`;
}

/**
 * Constant-time verification of a received signature — the routine a customer
 * runs on their endpoint, exported so it can be unit tested against the signer.
 */
export function verifySignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
