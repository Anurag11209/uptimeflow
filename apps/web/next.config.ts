import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@backend-uptime/shared"],
  // Pin the file-tracing root to the monorepo so build traces resolve
  // correctly. Without this, Next can infer a stray parent lockfile as the
  // workspace root and fail when collecting build traces.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
};

export default nextConfig;
