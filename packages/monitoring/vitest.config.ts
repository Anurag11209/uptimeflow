import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Probe tests connect to loopback fixtures; allow private ranges in tests.
    // The SSRF unit tests assert blocking explicitly via { allowPrivate: false }.
    env: { SSRF_ALLOW_PRIVATE_NETWORKS: "true" },
  },
});
