/**
 * Embedded PostgreSQL for the cross-package integration tests.
 *
 * The control plane is verified against a real PostgreSQL engine - the real
 * Prisma client, the real migration SQL and real constraints - without requiring
 * a database service: PGlite is PostgreSQL compiled to WebAssembly, and the
 * socket server exposes it over the PostgreSQL wire protocol.
 *
 * The migrations are applied exactly as they are committed (every
 * `packages/database/prisma/migrations/<name>/migration.sql`, in directory order), so
 * a migration that cannot run fails the suite.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../packages/database/prisma/migrations/', import.meta.url),
);

/** Candidate ports; the first one that binds is used. */
const CANDIDATE_PORTS = [55432, 55433, 55434, 55435, 55436];

export interface EmbeddedPostgres {
  /** Connection string for the PostgreSQL wire protocol. */
  url: string;
  stop(): Promise<void>;
}

/** Concatenates the committed migrations in directory order. */
export function readMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'))
    .join('\n');
}

export async function startEmbeddedPostgres(): Promise<EmbeddedPostgres> {
  const database = new PGlite();
  await database.exec(readMigrationSql());

  for (const port of CANDIDATE_PORTS) {
    const server = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port });

    try {
      await server.start();

      return {
        url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
        stop: async () => {
          await server.stop();
          await database.close();
        },
      };
    } catch {
      // Port already in use: try the next candidate.
    }
  }

  await database.close();
  throw new Error('No free port available for the embedded PostgreSQL server.');
}
