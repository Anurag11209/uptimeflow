import type { PrismaClient } from "@backend-uptime/db";
import type {
  AlertContext,
  AlertDispatcher,
  EscalationContext,
  EscalationStarter,
  MonitorSnapshot,
  ProbeSignal,
} from "../src/index.js";

/** A baseline HTTP monitor snapshot; override any field per test. */
export function snap(over: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    id: "mon_1",
    organizationId: "org_1",
    name: "Acme API",
    type: "HTTP",
    url: "https://example.com",
    host: null,
    port: null,
    httpMethod: "GET",
    requestHeaders: null,
    requestBody: null,
    expectedStatus: 200,
    keyword: null,
    keywordInverted: false,
    followRedirects: true,
    verifySsl: true,
    timeoutSeconds: 30,
    retries: 0,
    intervalSeconds: 60,
    failureThreshold: 1,
    successThreshold: 1,
    escalationPolicyId: null,
    health: "PENDING",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastCheckedAt: null,
    assertions: [],
    ...over,
  };
}

/** A reachable probe signal; override per test. */
export function sig(over: Partial<ProbeSignal> = {}): ProbeSignal {
  return { reachable: true, responseMs: 120, statusCode: 200, headers: {}, body: "", ...over };
}

export interface CapturedWrites {
  checkResults: Array<Record<string, unknown>>;
  monitorUpdates: Array<Record<string, unknown>>;
  incidentCreates: Array<Record<string, unknown>>;
  incidentUpdates: Array<{ where: unknown; data: Record<string, unknown> }>;
  incidentEvents: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
}

export interface MockPrismaOptions {
  maintenance?: boolean;
  openIncident?: { id: string; startedAt: Date } | null;
  monitorRow?: Record<string, unknown> | null;
  /** Number of recent incidents detectFlapping sees (>= FLAP_THRESHOLD ⇒ flapping). */
  incidentCount?: number;
}

/** Capturing alert dispatcher double for pipeline tests. */
export function spyDispatcher(): { alerts: AlertDispatcher; calls: AlertContext[] } {
  const calls: AlertContext[] = [];
  return {
    calls,
    alerts: {
      dispatch: async (ctx) => {
        calls.push(ctx);
        return 1;
      },
      dispatchToChannels: async (ctx) => ctx.channelIds.length,
    },
  };
}

/** Capturing escalation starter double for pipeline tests. */
export function spyEscalation(): { escalation: EscalationStarter; starts: EscalationContext[] } {
  const starts: EscalationContext[] = [];
  return {
    starts,
    escalation: {
      start: async (ctx) => {
        starts.push(ctx);
        return true;
      },
    },
  };
}

/** In-memory Prisma double that records the engine's writes. */
export function mockPrisma(options: MockPrismaOptions = {}): {
  prisma: PrismaClient;
  writes: CapturedWrites;
} {
  const writes: CapturedWrites = {
    checkResults: [],
    monitorUpdates: [],
    incidentCreates: [],
    incidentUpdates: [],
    incidentEvents: [],
    audits: [],
  };

  const prisma = {
    maintenanceWindow: {
      findFirst: async () => (options.maintenance ? { id: "mw_1" } : null),
    },
    checkResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.checkResults.push(data);
        return { id: "cr_1" };
      },
    },
    monitor: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.monitorUpdates.push(data);
        return {};
      },
      findFirst: async () => options.monitorRow ?? null,
    },
    incident: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.incidentCreates.push(data);
        return { id: "inc_1" };
      },
      findFirst: async () => options.openIncident ?? null,
      count: async () => options.incidentCount ?? 0,
      update: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
        writes.incidentUpdates.push({ where, data });
        return {};
      },
    },
    incidentEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.incidentEvents.push(data);
        return { id: "ev_1" };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.audits.push(data);
        return {};
      },
    },
  } as unknown as PrismaClient;

  return { prisma, writes };
}
