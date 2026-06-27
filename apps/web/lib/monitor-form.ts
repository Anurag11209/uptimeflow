/**
 * Pure form model for create/edit monitor. All validation and payload-building
 * lives here (no React) so it is fully unit-tested and shared by both pages.
 * Mirrors the backend zod schema in apps/api/src/routes/monitors.ts.
 */

import type {
  HttpMethod,
  MonitorDetail,
  MonitorPayload,
  MonitorType,
  ProbeRegion,
} from "@/lib/monitors";

export interface MonitorFormState {
  name: string;
  type: MonitorType;
  url: string;
  host: string;
  port: string;
  httpMethod: HttpMethod;
  expectedStatus: string;
  keyword: string;
  keywordInverted: boolean;
  requestHeaders: string;
  intervalSeconds: string;
  timeoutSeconds: string;
  retries: string;
  regions: ProbeRegion[];
  failureThreshold: string;
  successThreshold: string;
  escalationPolicyId: string;
  channelIds: string[];
}

export const INTERVAL_OPTIONS = [30, 60, 120, 300, 600, 1800, 3600] as const;

export function defaultMonitorForm(): MonitorFormState {
  return {
    name: "",
    type: "HTTP",
    url: "",
    host: "",
    port: "",
    httpMethod: "GET",
    expectedStatus: "",
    keyword: "",
    keywordInverted: false,
    requestHeaders: "",
    intervalSeconds: "60",
    timeoutSeconds: "30",
    retries: "2",
    regions: [],
    failureThreshold: "1",
    successThreshold: "1",
    escalationPolicyId: "",
    channelIds: [],
  };
}

export function formStateFromMonitor(m: MonitorDetail): MonitorFormState {
  return {
    name: m.name,
    type: m.type,
    url: m.url ?? "",
    host: m.host ?? "",
    port: m.port !== null ? String(m.port) : "",
    httpMethod: m.httpMethod ?? "GET",
    expectedStatus: m.expectedStatus !== null ? String(m.expectedStatus) : "",
    keyword: m.keyword ?? "",
    keywordInverted: m.keywordInverted,
    requestHeaders: serializeHeaders(m.requestHeaders),
    intervalSeconds: String(m.intervalSeconds),
    timeoutSeconds: String(m.timeoutSeconds),
    retries: String(m.retries),
    regions: m.regions,
    failureThreshold: String(m.failureThreshold),
    successThreshold: String(m.successThreshold),
    escalationPolicyId: m.escalationPolicyId ?? "",
    channelIds: m.boundChannelIds,
  };
}

// ─── Per-type field visibility ──────────────────────────────────────────────

export function typeNeedsUrl(type: MonitorType): boolean {
  return type === "HTTP" || type === "KEYWORD" || type === "SSL";
}
export function typeNeedsHost(type: MonitorType): boolean {
  return type === "TCP" || type === "PORT" || type === "PING";
}
export function typeNeedsPort(type: MonitorType): boolean {
  return type === "TCP" || type === "PORT";
}
export function typeIsHttp(type: MonitorType): boolean {
  return type === "HTTP" || type === "KEYWORD";
}
export function typeIsKeyword(type: MonitorType): boolean {
  return type === "KEYWORD";
}
export function typeIsHeartbeat(type: MonitorType): boolean {
  return type === "HEARTBEAT";
}

// ─── Header (de)serialization ───────────────────────────────────────────────

/** Render a header record as newline-separated "Key: Value" lines. */
export function serializeHeaders(
  headers: Record<string, string> | null,
): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export interface ParsedHeaders {
  headers?: Record<string, string>;
  error?: string;
}

/** Parse "Key: Value" lines into a record; reports the first malformed line. */
export function parseHeaders(text: string): ParsedHeaders {
  const trimmed = text.trim();
  if (!trimmed) return { headers: undefined };
  const headers: Record<string, string> = {};
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      return { error: `Invalid header line: "${line}". Use "Key: Value".` };
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) return { error: `Invalid header line: "${line}".` };
    headers[key] = value;
  }
  return { headers: Object.keys(headers).length ? headers : undefined };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export type MonitorFormErrors = Partial<Record<keyof MonitorFormState, string>>;

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function intInRange(
  value: string,
  min: number,
  max: number,
): number | null {
  if (!/^-?\d+$/.test(value.trim())) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function validateMonitorForm(state: MonitorFormState): MonitorFormErrors {
  const errors: MonitorFormErrors = {};

  if (!state.name.trim()) {
    errors.name = "Name is required.";
  } else if (state.name.trim().length > 200) {
    errors.name = "Name must be 200 characters or fewer.";
  }

  if (typeNeedsUrl(state.type)) {
    if (!state.url.trim()) errors.url = "A URL is required for this monitor type.";
    else if (!isValidUrl(state.url.trim()))
      errors.url = "Enter a valid http(s) URL.";
  }

  if (typeNeedsHost(state.type) && !state.host.trim()) {
    errors.host = "A host is required for this monitor type.";
  }

  if (typeNeedsPort(state.type)) {
    const port = intInRange(state.port, 1, 65535);
    if (port === null) errors.port = "Enter a port between 1 and 65535.";
  }

  if (typeIsKeyword(state.type) && !state.keyword.trim()) {
    errors.keyword = "A keyword is required for keyword monitors.";
  }

  if (state.expectedStatus.trim()) {
    if (intInRange(state.expectedStatus, 100, 599) === null) {
      errors.expectedStatus = "Status must be between 100 and 599.";
    }
  }

  // Heartbeat has no outbound probe, so timeout/retries/regions are irrelevant.
  if (!typeIsHeartbeat(state.type)) {
    if (intInRange(state.timeoutSeconds, 1, 60) === null) {
      errors.timeoutSeconds = "Timeout must be between 1 and 60 seconds.";
    }
    if (intInRange(state.retries, 0, 5) === null) {
      errors.retries = "Retries must be between 0 and 5.";
    }
  }

  if (intInRange(state.intervalSeconds, 30, 86_400) === null) {
    errors.intervalSeconds = "Interval must be between 30 and 86400 seconds.";
  }
  if (intInRange(state.failureThreshold, 1, 10) === null) {
    errors.failureThreshold = "Failure threshold must be between 1 and 10.";
  }
  if (intInRange(state.successThreshold, 1, 10) === null) {
    errors.successThreshold = "Success threshold must be between 1 and 10.";
  }

  if (state.requestHeaders.trim() && typeIsHttp(state.type)) {
    const parsed = parseHeaders(state.requestHeaders);
    if (parsed.error) errors.requestHeaders = parsed.error;
  }

  return errors;
}

export function isFormValid(errors: MonitorFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

// ─── Payload building ───────────────────────────────────────────────────────

/**
 * Build the API payload from a validated form. Only sends fields relevant to
 * the selected type, so the backend never receives a stray url on a TCP check.
 */
export function buildMonitorPayload(state: MonitorFormState): MonitorPayload {
  const payload: MonitorPayload = {
    name: state.name.trim(),
    type: state.type,
    intervalSeconds: Number(state.intervalSeconds),
    failureThreshold: Number(state.failureThreshold),
    successThreshold: Number(state.successThreshold),
    channelIds: state.channelIds,
  };

  if (typeNeedsUrl(state.type)) payload.url = state.url.trim();
  if (typeNeedsHost(state.type)) payload.host = state.host.trim();
  if (typeNeedsPort(state.type)) payload.port = Number(state.port);

  if (typeIsHttp(state.type)) {
    payload.httpMethod = state.httpMethod;
    if (state.expectedStatus.trim()) {
      payload.expectedStatus = Number(state.expectedStatus);
    }
    const parsed = parseHeaders(state.requestHeaders);
    if (parsed.headers) payload.requestHeaders = parsed.headers;
  }

  if (typeIsKeyword(state.type)) {
    payload.keyword = state.keyword.trim();
    payload.keywordInverted = state.keywordInverted;
  }

  if (!typeIsHeartbeat(state.type)) {
    payload.timeoutSeconds = Number(state.timeoutSeconds);
    payload.retries = Number(state.retries);
    if (state.regions.length) payload.regions = state.regions;
  }

  if (state.escalationPolicyId) {
    payload.escalationPolicyId = state.escalationPolicyId;
  }

  return payload;
}
