import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

/** Connection settings for a database client. */
export interface DatabaseClientOptions {
  /** PostgreSQL connection string (`postgresql://user:password@host:port/database`). */
  connectionString: string;
  /** Maximum number of pooled connections. Defaults to the `pg` driver default. */
  maxConnections?: number;
  /** PostgreSQL schema to query when it is not the `public` schema. */
  schema?: string;
}

/**
 * Creates a Prisma client bound to a PostgreSQL connection pool.
 *
 * Prisma 7 is engine-free: the client reaches PostgreSQL through the `pg` driver
 * adapter, so the connection is always provided explicitly by the caller rather
 * than read from a hidden global. The control plane creates one client at
 * startup and injects it into the services that need it (see `.clinerules` →
 * dependency injection for infrastructure adapters).
 *
 * The client is not connected until the first query; `client.$disconnect()`
 * releases the pool.
 */
export function createDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  const adapter = new PrismaPg(
    {
      connectionString: options.connectionString,
      ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
    },
    options.schema === undefined ? undefined : { schema: options.schema },
  );

  return new PrismaClient({ adapter });
}
