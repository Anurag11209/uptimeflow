import type {
  AssertionComparator,
  AssertionSource,
  CheckStatus,
  HttpMethod,
  MonitorHealth,
  MonitorType,
  ProbeRegion,
} from "@backend-uptime/db";

/**
 * The minimal, denormalized view of a Monitor the engine needs to run one
 * check. Decoupled from the Prisma row so probes/assertions/pipeline are unit
 * testable without a database.
 */
export interface MonitorSnapshot {
  id: string;
  organizationId: string;
  name: string;
  type: MonitorType;

  // Target
  url: string | null;
  host: string | null;
  port: number | null;
  httpMethod: HttpMethod | null;
  requestHeaders: Record<string, string> | null;
  requestBody: string | null;
  expectedStatus: number | null;
  keyword: string | null;
  keywordInverted: boolean;
  followRedirects: boolean;
  verifySsl: boolean;

  // Evaluation
  timeoutSeconds: number;
  retries: number;
  intervalSeconds: number;
  failureThreshold: number;
  successThreshold: number;

  /** Escalation policy to drive incident paging, when configured. */
  escalationPolicyId: string | null;

  // Current persisted state (state machine inputs)
  health: MonitorHealth;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: Date | null;

  assertions: AssertionDef[];
}

export interface AssertionDef {
  source: AssertionSource;
  comparator: AssertionComparator;
  property: string | null;
  expected: string;
}

/** TLS certificate facts surfaced by HTTPS/SSL probes. */
export interface CertInfo {
  validTo: Date;
  validFrom: Date;
  daysUntilExpiry: number;
  issuer: string | null;
  subject: string | null;
}

/**
 * Raw, network-level result of a single probe attempt. Probes never decide
 * UP/DOWN — they report what happened; `evaluateOutcome` classifies it.
 */
export interface ProbeSignal {
  reachable: boolean;
  responseMs: number;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  cert?: CertInfo;
  /** Coarse failure bucket when unreachable: dns | connect | refused | tls | timeout | error. */
  errorType?: string;
  errorMessage?: string;
}

export type ValidationSeverity = "error" | "warn";

export interface ValidationResult {
  ok: boolean;
  /** error → DOWN, warn → DEGRADED. Only meaningful when ok=false. */
  severity: ValidationSeverity;
  code: string;
  message: string;
}

/** Final classification of a check after probe + validations + retries. */
export interface ProbeOutcome {
  status: CheckStatus;
  statusCode?: number;
  responseMs?: number;
  errorType?: string;
  errorMessage?: string;
  cert?: CertInfo;
  validations: ValidationResult[];
  attempts: number;
}

export interface ProbeContext {
  signal: AbortSignal;
  now: Date;
}

/** A probe runs one network attempt for a monitor and reports the raw signal. */
export type Probe = (monitor: MonitorSnapshot, ctx: ProbeContext) => Promise<ProbeSignal>;

export type ProbeRegistry = Partial<Record<MonitorType, Probe>>;

/** Payload carried on the BullMQ monitor-check queue (one per region). */
export interface CheckJobData {
  monitorId: string;
  organizationId: string;
  region: ProbeRegion;
}
