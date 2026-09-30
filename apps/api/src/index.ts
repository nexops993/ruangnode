import {
  createArgon2idPasswordHasher,
  createPrismaAuthStore,
  NullPasswordResetNotifier,
} from '@ruangnode/auth';
import {
  createDatabaseClient,
  databaseUrlFromEnv,
  loadEnvironmentFiles,
} from '@ruangnode/database';

import { authConfigFromEnv } from './auth/config.js';
import { buildServer } from './server.js';

const DEFAULT_API_PORT = 3001;

/**
 * Resolves the listening port from the environment.
 *
 * Configuration is validated at the boundary: an invalid port fails fast
 * instead of silently binding somewhere unexpected.
 */
export function resolveApiPort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort.trim() === '') {
    return DEFAULT_API_PORT;
  }

  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }

  return port;
}

const host = process.env.API_HOST ?? '0.0.0.0';

interface Bootstrap {
  app: ReturnType<typeof buildServer>;
  disconnect: () => Promise<void>;
}

/**
 * Wires the production dependencies.
 *
 * Authentication is always enabled here: the database client, the Prisma-backed
 * store, the Argon2id hasher and the cookie configuration are resolved before the
 * process starts listening, so a misconfigured deployment fails immediately
 * instead of running without working authentication.
 */
function bootstrap(): Bootstrap {
  // Prisma 7 no longer reads `.env` automatically; the root `.env` is loaded
  // explicitly before any configuration is read.
  loadEnvironmentFiles();

  const config = authConfigFromEnv();
  const prisma = createDatabaseClient({ connectionString: databaseUrlFromEnv() });

  const app = buildServer({
    logger: true,
    auth: {
      store: createPrismaAuthStore(prisma),
      hasher: createArgon2idPasswordHasher(),
      // Password-reset email delivery is not implemented yet; the reset token is
      // created and stored, but no message is sent. See docs/DECISIONS.md.
      notifier: new NullPasswordResetNotifier(),
      config,
    },
  });

  return { app, disconnect: () => prisma.$disconnect() };
}

function bootstrapOrExit(): Bootstrap {
  try {
    return bootstrap();
  } catch (error) {
    // Configuration failures never include secret values.
    console.error(
      'Failed to start the control plane API:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

const { app, disconnect } = bootstrapOrExit();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'Shutting down the control plane API');
  await app.close();
  await disconnect();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ host, port: resolveApiPort(process.env.API_PORT) });
} catch (error) {
  app.log.error({ err: error }, 'Failed to start the control plane API');
  process.exit(1);
}
