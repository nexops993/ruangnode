import { AppError, type ErrorResponseBody } from '@ruangnode/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { API_SERVICE_NAME, type HealthStatus } from './routes/health.js';
import { buildServer } from './server.js';

const openServers: ReturnType<typeof buildServer>[] = [];

function createServer(): ReturnType<typeof buildServer> {
  const app = buildServer();
  openServers.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((app) => app.close()));
});

describe('control plane API', () => {
  it('answers the liveness endpoint', async () => {
    const app = createServer();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);

    const body = response.json<HealthStatus>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe(API_SERVICE_NAME);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns a structured envelope for unknown endpoints', async () => {
    const app = createServer();

    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);

    const body = response.json<ErrorResponseBody>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.retryable).toBe(false);
  });

  it('maps an AppError to its status code and safe body', async () => {
    const app = createServer();
    app.get('/__test__/forbidden', () => {
      throw AppError.forbidden('You are not allowed to perform this action.');
    });

    const response = await app.inject({ method: 'GET', url: '/__test__/forbidden' });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorResponseBody>()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You are not allowed to perform this action.',
        retryable: false,
      },
    });
  });

  it('does not leak internal detail of unexpected errors', async () => {
    const app = createServer();
    app.get('/__test__/unexpected', () => {
      throw new Error('ECONNREFUSED 10.0.0.5:5432');
    });

    const response = await app.inject({ method: 'GET', url: '/__test__/unexpected' });

    expect(response.statusCode).toBe(500);
    expect(response.json<ErrorResponseBody>().error.code).toBe('INTERNAL');
    expect(response.body).not.toContain('10.0.0.5');
    expect(response.body).not.toContain('ECONNREFUSED');
  });
});
