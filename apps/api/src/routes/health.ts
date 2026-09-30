import type { FastifyInstance } from 'fastify';

export const API_SERVICE_NAME = 'ruangnode-api';

export interface HealthStatus {
  status: 'ok';
  service: typeof API_SERVICE_NAME;
  uptimeSeconds: number;
}

/**
 * Liveness endpoint used by the reverse proxy and by deployment tooling.
 *
 * Phase 0 reports process liveness only. Readiness checks (database, queue,
 * node registry) are added together with those dependencies in later phases.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', (): HealthStatus => {
    return {
      status: 'ok',
      service: API_SERVICE_NAME,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });
}
