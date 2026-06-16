import "dotenv/config";

import { defineConfig } from "prisma/config";

// Prisma 7 moved the connection URL out of the schema's datasource block and
// into this config file (used by Migrate / introspection). The runtime client
// gets its connection separately via the pg driver adapter (see src/index.ts).
//
// `prisma generate` loads this config but needs no database connection, and CI
// has no DATABASE_URL. `env("DATABASE_URL")` throws when the var is missing, so
// wire the datasource only when the URL is actually present — generate works
// without it, while migrate/db push still get the real URL when it is set.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
  // Replaces the deprecated `package.json#prisma.seed` block.
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
