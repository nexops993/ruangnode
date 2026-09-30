/**
 * Prisma CLI configuration (Prisma ORM 7).
 *
 * Prisma 7 moved the database connection out of the `datasource` block in
 * `schema.prisma` and into this file, and stopped reading `.env` files
 * automatically. The environment is therefore loaded explicitly here using
 * Node's built-in `process.loadEnvFile` (no extra dependency):
 *
 *   - running from `packages/database` -> `packages/database/.env`, then the
 *     repository root `.env`
 *   - running from the repository root -> the repository root `.env`
 *
 * `datasource.url` is only set when DATABASE_URL exists, so schema validation
 * and client generation work in environments without a database (CI), while
 * migration and seed commands fail loudly with Prisma's own message instead of
 * silently connecting somewhere unexpected.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

function loadEnvironmentFiles(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '..', '.env')];

  for (const file of candidates) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }
}

loadEnvironmentFiles();

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(databaseUrl === undefined || databaseUrl === '' ? {} : { datasource: { url: databaseUrl } }),
});
