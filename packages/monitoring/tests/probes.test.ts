import { createServer, type AddressInfo, type Server } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { httpProbe, pingProbe, tcpProbe } from "../src/index.js";
import type { ProbeContext } from "../src/index.js";
import { snap } from "./fixtures.js";

const ctx = (): ProbeContext => ({ signal: new AbortController().signal, now: new Date() });

const servers: Array<Server | HttpServer> = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    (s as HttpServer).closeAllConnections?.();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function tcpServer(): Promise<number> {
  const server = createServer((socket) => socket.end());
  servers.push(server);
  server.listen(0);
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function httpServer(handler: Parameters<typeof createHttpServer>[0]): Promise<number> {
  const server = createHttpServer(handler);
  servers.push(server);
  server.listen(0);
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

describe("tcp / ping probes", () => {
  it("tcpProbe connects to a listening port", async () => {
    const port = await tcpServer();
    const out = await tcpProbe(snap({ type: "TCP", host: "127.0.0.1", port }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.responseMs).toBeGreaterThanOrEqual(0);
  });

  it("tcpProbe reports refused on a closed port", async () => {
    const port = await tcpServer();
    // Close the server so nothing is listening on that port.
    await new Promise<void>((r) => servers.splice(0)[0]!.close(() => r()));
    const out = await tcpProbe(snap({ type: "TCP", host: "127.0.0.1", port }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("refused");
  });

  it("pingProbe checks reachability via TCP", async () => {
    const port = await tcpServer();
    const out = await pingProbe(snap({ type: "PING", host: "127.0.0.1", port }), ctx());
    expect(out.reachable).toBe(true);
  });
});

describe("http probe", () => {
  it("captures status, body, and headers on success", async () => {
    const port = await httpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pong");
    });
    const out = await httpProbe(snap({ type: "HTTP", url: `http://127.0.0.1:${port}/` }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.statusCode).toBe(200);
    expect(out.body).toBe("pong");
    expect(out.headers?.["content-type"]).toContain("text/plain");
  });

  it("treats a 5xx as reachable (validation decides health)", async () => {
    const port = await httpServer((_req, res) => {
      res.writeHead(503);
      res.end("nope");
    });
    const out = await httpProbe(snap({ type: "HTTP", url: `http://127.0.0.1:${port}/` }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.statusCode).toBe(503);
  });

  it("times out a hung response", async () => {
    const port = await httpServer(() => {
      /* never responds */
    });
    const out = await httpProbe(
      snap({ type: "HTTP", url: `http://127.0.0.1:${port}/`, timeoutSeconds: 0.3 }),
      ctx(),
    );
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("timeout");
  });
});
