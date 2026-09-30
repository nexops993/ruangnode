import { buildServer } from '@ruangnode/api';
import {
  AppError,
  HTTP_STATUS_BY_ERROR_CODE,
  toErrorResponse,
  type ErrorResponseBody,
} from '@ruangnode/shared';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Integration tests for the control plane API <-> shared primitives contract.
 *
 * These run the real Fastify instance built by `@ruangnode/api` in-process and
 * assert that the error taxonomy published by `@ruangnode/shared` is exactly
 * what clients observe over HTTP.
 */
const openServers: ReturnType<typeof buildServer>[] = [];

function createServer(): ReturnType<typeof buildServer> {
  const app = buildServer();
  openServers.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((app) => app.close()));
});

describe('control plane API contract', () => {
  it('serves the liveness endpoint as JSON', async () => {
    const app = createServer();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json<{ status: string }>().status).toBe('ok');
  });

  it('serialises AppError through the shared error envelope', async () => {
    const app = createServer();
    app.get('/__test__/rate-limited', () => {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Try again shortly.',
        retryable: true,
      });
    });

    const response = await app.inject({ method: 'GET', url: '/__test__/rate-limited' });
    const body = response.json<ErrorResponseBody>();

    expect(response.statusCode).toBe(HTTP_STATUS_BY_ERROR_CODE.RATE_LIMITED);
    expect(body).toEqual(
      toErrorResponse(
        new AppError({
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Try again shortly.',
          retryable: true,
        }),
      ).body,
    );
  });

  it('keeps concurrent server instances isolated', async () => {
    const first = createServer();
    const second = createServer();

    first.get('/__test__/only-on-first', () => ({ scope: 'first' }));

    expect((await first.inject({ method: 'GET', url: '/__test__/only-on-first' })).statusCode).toBe(
      200,
    );
    expect(
      (await second.inject({ method: 'GET', url: '/__test__/only-on-first' })).statusCode,
    ).toBe(404);
  });
});
