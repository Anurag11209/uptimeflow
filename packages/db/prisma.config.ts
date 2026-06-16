import "dotenv/config";

import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the connection URL out of the schema's datasource block and
// into this config file (used by Migrate / introspection). The runtime client
// gets its connection separately via the pg driver adapter (see src/index.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  // Replaces the deprecated `package.json#prisma.seed` block.
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
