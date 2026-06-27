import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration delivery tests post to stub fetch on public-looking hosts;
    // allow private ranges so the guard does not perform real DNS in tests.
    // The SSRF unit tests assert blocking explicitly via { allowPrivate: false }.
    env: { SSRF_ALLOW_PRIVATE_NETWORKS: "true" },
  },
});
