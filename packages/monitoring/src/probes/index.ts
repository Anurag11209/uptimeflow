import type { ProbeRegistry } from "../types.js";
import { httpProbe } from "./http.js";
import { sslProbe } from "./ssl.js";
import { pingProbe, tcpProbe } from "./tcp.js";
import { heartbeatProbe } from "./heartbeat.js";

export { httpProbe } from "./http.js";
export { sslProbe } from "./ssl.js";
export { tcpProbe, pingProbe } from "./tcp.js";
export { heartbeatProbe, HEARTBEAT_GRACE_MS } from "./heartbeat.js";

/**
 * Maps each monitor type to its probe. HTTP/HTTPS/API/KEYWORD all run the HTTP
 * probe (scheme + assertions distinguish them); PORT reuses the TCP probe. DNS
 * and GRPC are declared in the schema but not yet implemented.
 */
export const defaultProbes: ProbeRegistry = {
  HTTP: httpProbe,
  KEYWORD: httpProbe,
  SSL: sslProbe,
  TCP: tcpProbe,
  PORT: tcpProbe,
  PING: pingProbe,
  HEARTBEAT: heartbeatProbe,
};
