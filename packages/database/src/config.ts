/**
 * Environment handling for database tooling and processes.
 *
 * Prisma 7 no longer reads `.env` files automatically, and this repository
 * keeps a single root `.env` (see `.env.example`). These helpers load it
 * explicitly using Node's built-in `process.loadEnvFile`, so no `dotenv`
 * dependency is required.
 *
 * `prisma.config.ts` intentionally contains its own copy of the loading logic:
 * it is executed by the Prisma CLI's TypeScript loader, which must not depend on
 * package-internal module resolution.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the environment files that exist, in order, without overriding values
 * that are already present in the process environment.
 *
 * Candidates:
 *   - `<cwd>/.env`            (e.g. `packages/database/.env`)
 *   - `<cwd>/../../.env`      (the repository root when run from a package)
 */
export function loadEnvironmentFiles(cwd: string = process.cwd()): void {
  const candidates = [resolve(cwd, '.env'), resolve(cwd, '..', '..', '.env')];

  for (const file of candidates) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }
}

/**
 * Reads the PostgreSQL connection string from the environment.
 *
 * Throws instead of silently falling back to driver defaults, which would
 * otherwise surface as a confusing authentication error.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;

  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not configured. Copy .env.example to .env and set DATABASE_URL, ' +
        'or export it in the environment before running database commands.',
    );
  }

  return url;
}
