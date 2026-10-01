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
import { createCommerceServices, createPrismaCommerceStore, createPrismaInfrastructureStore, InfrastructureReconciler, InstanceService, NodeRegistryService, NodeScheduler, ProvisioningService } from '@ruangnode/services';
import { createHttpNodeAgent } from '@ruangnode/node-agent';

import { authConfigFromEnv } from './auth/config.js';
import { buildServer, type BuildServerOptions } from './server.js';

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
  reconcile: () => Promise<void>;
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
  const infrastructure = infrastructureFromEnv(prisma);

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
    // Catalog, resource profiles and orders. The store is the only database
    // dependency the services see (`.clinerules` → dependency injection).
    commerce: {
      services: createCommerceServices({ store: createPrismaCommerceStore(prisma) }),
    },
    ...(infrastructure === undefined ? {} : { infrastructure: infrastructure.options }),
  });

  return { app, disconnect: () => prisma.$disconnect(), reconcile: async () => { if (infrastructure !== undefined) await infrastructure.reconciler.reconcile(); } };
}

function infrastructureFromEnv(prisma: ReturnType<typeof createDatabaseClient>): { options: NonNullable<BuildServerOptions['infrastructure']>; reconciler: InfrastructureReconciler } | undefined {
  const baseUrl = process.env.NODE_AGENT_URL;
  const token = process.env.NODE_AGENT_TOKEN;
  if (baseUrl === undefined && token === undefined) return undefined;
  if (baseUrl === undefined || token === undefined || token.length < 32) {
    throw new Error('NODE_AGENT_URL and NODE_AGENT_TOKEN (at least 32 characters) are required together.');
  }
  const store = createPrismaInfrastructureStore(prisma);
  const agent = createHttpNodeAgent({ baseUrl, token });
  return {
    options: { instances: new InstanceService(store.instances, agent), nodes: store.nodes, nodeRegistry: new NodeRegistryService(store.nodes, store.credentials), provisioning: new ProvisioningService({ jobs: store.jobs, instances: store.instances, nodes: new NodeScheduler(store.nodes), agent, orders: store.paidOrders }) },
    reconciler: new InfrastructureReconciler({ jobs: store.jobs, instances: store.instances, agent }),
  };
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

const { app, disconnect, reconcile } = bootstrapOrExit();

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
  await reconcile();
  await app.listen({ host, port: resolveApiPort(process.env.API_PORT) });
} catch (error) {
  app.log.error({ err: error }, 'Failed to start the control plane API');
  process.exit(1);
}
