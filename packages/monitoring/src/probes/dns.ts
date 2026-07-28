import { Resolver } from "node:dns/promises";
import { isBlockedIp, SsrfError } from "@backend-uptime/notifications";
import type { DnsInfo, DnsRecordType, MonitorSnapshot, Probe, ProbeContext, ProbeSignal } from "../types.js";

/** Query type used when a monitor has no explicit DNS_RECORD assertion. */
const DEFAULT_RECORD_TYPE: DnsRecordType = "A";

const RECORD_TYPES = new Set<DnsRecordType>(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA"]);

/** The DNS_RECORD assertion's `property` names the record type to query. */
function recordTypeFor(monitor: MonitorSnapshot): DnsRecordType {
  const assertion = monitor.assertions.find((a) => a.source === "DNS_RECORD" && a.property);
  const requested = assertion?.property?.trim().toUpperCase();
  if (requested && RECORD_TYPES.has(requested as DnsRecordType)) {
    return requested as DnsRecordType;
  }
  return DEFAULT_RECORD_TYPE;
}

/** Render one resolved record as a single comparable string. */
function stringifyRecord(recordType: DnsRecordType, record: unknown): string {
  if (recordType === "MX") {
    const r = record as { priority: number; exchange: string };
    return `${r.priority} ${r.exchange}`;
  }
  if (recordType === "SOA") {
    const r = record as { nsname: string; hostmaster: string; serial: number };
    return `${r.nsname} ${r.hostmaster} ${r.serial}`;
  }
  if (recordType === "TXT") {
    // Each TXT answer is an array of chunks; join them back into one string.
    return (record as string[]).join("");
  }
  return String(record);
}

/**
 * DNS probe. Resolves the monitor's host for one record type (A by default,
 * or whatever type a DNS_RECORD assertion names) and reports every value
 * found — reachability is "resolution succeeded"; matching a specific value
 * is left to `evaluateValidations`/DNS_RECORD assertions.
 *
 * Every resolved address is checked against the same private/reserved-range
 * denylist the HTTP/TCP probes use: DNS answers are attacker-influenced data,
 * so a monitor can't be used to fingerprint or reach internal infrastructure
 * by pointing a DNS check at a name that resolves to a private IP.
 */
export const dnsProbe: Probe = async (monitor, ctx) => {
  const host = monitor.host?.trim();
  if (!host) {
    return { reachable: false, responseMs: 0, errorType: "config", errorMessage: "Monitor needs a host." };
  }

  const recordType = recordTypeFor(monitor);
  const started = performance.now();

  const resolver = new Resolver({ timeout: monitor.timeoutSeconds * 1000, tries: 1 });
  // The nameserver the resolver itself talks to is the platform's own
  // resolv.conf default — only the *answers* (A/AAAA targets) need SSRF
  // screening, since those are what a subsequent probe or a person might
  // treat as "this monitor confirmed this address is reachable".

  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(Object.assign(new Error("DNS lookup aborted."), { code: "ETIMEDOUT" }));
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const records = await Promise.race([resolveRecords(resolver, host, recordType), abortPromise]);
    const responseMs = Math.round(performance.now() - started);

    if (recordType === "A" || recordType === "AAAA") {
      for (const value of records) {
        if (isBlockedIp(value)) {
          return {
            reachable: false,
            responseMs,
            errorType: "blocked",
            errorMessage: `"${host}" resolves to blocked address ${value}.`,
          };
        }
      }
    }

    if (records.length === 0) {
      return {
        reachable: false,
        responseMs,
        errorType: "dns",
        errorMessage: `No ${recordType} records found for "${host}".`,
      };
    }

    const dns: DnsInfo = { recordType, values: records };
    return { reachable: true, responseMs, dns };
  } catch (error) {
    const responseMs = Math.round(performance.now() - started);
    if (error instanceof SsrfError) {
      return { reachable: false, responseMs, errorType: "blocked", errorMessage: error.message };
    }
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ETIMEDOUT" || ctx.signal.aborted) {
      return { reachable: false, responseMs, errorType: "timeout", errorMessage: "DNS lookup timed out." };
    }
    const notFound = err.code === "ENOTFOUND" || err.code === "ENODATA" || err.code === "ESERVFAIL";
    return {
      reachable: false,
      responseMs,
      errorType: notFound ? "dns" : "error",
      errorMessage: err.message ?? `DNS lookup for "${host}" failed.`,
    };
  }
};

async function resolveRecords(resolver: Resolver, host: string, recordType: DnsRecordType): Promise<string[]> {
  switch (recordType) {
    case "A":
      return resolver.resolve4(host);
    case "AAAA":
      return resolver.resolve6(host);
    case "CNAME":
      return resolver.resolveCname(host);
    case "NS":
      return resolver.resolveNs(host);
    case "MX": {
      const records = await resolver.resolveMx(host);
      return records.map((r) => stringifyRecord("MX", r));
    }
    case "TXT": {
      const records = await resolver.resolveTxt(host);
      return records.map((r) => stringifyRecord("TXT", r));
    }
    case "SOA": {
      const record = await resolver.resolveSoa(host);
      return [stringifyRecord("SOA", record)];
    }
    default:
      return [];
  }
}
