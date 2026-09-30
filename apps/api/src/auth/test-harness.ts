/**
 * Test harness for the authentication routes.
 *
 * TEST-ONLY. Nothing in this file is imported by `server.ts` or `index.ts`: the
 * deployed process always wires the Prisma store (`index.ts`). The harness exists
 * so the API tests drive the real Fastify instance with the in-memory store from
 * `@ruangnode/auth/testing` instead of duplicating the wiring in every test file.
 */
import {
  AUTH_RATE_LIMITS,
  AuthService,
  createArgon2idPasswordHasher,
  createInMemoryRateLimiter,
  type RateLimiter,
} from '@ruangnode/auth';
import {
  TEST_ARGON2ID_PARAMS,
  createCapturingPasswordResetNotifier,
  createInMemoryAuthStore,
  createTestClock,
  type CapturingPasswordResetNotifier,
  type InMemoryAuthStore,
  type TestClock,
} from '@ruangnode/auth/testing';
import type { FastifyServerOptions } from 'fastify';

import { buildServer } from '../server.js';
import { SESSION_COOKIE_NAME, type AuthConfig, type AuthRateLimitConfig } from './config.js';

/** Long enough to satisfy the `SESSION_SECRET` minimum; not a real secret. */
export const TEST_SESSION_SECRET = 'ruangnode-test-session-secret-value-32';

export const TEST_PASSWORD = 'correct-horse-battery-staple';
export const TEST_NEW_PASSWORD = 'a-brand-new-passphrase-2026';
export const TEST_EMAIL = 'ada@example.com';
export const TEST_START = '2026-01-01T00:00:00.000Z';

export interface TestServerOptions {
  start?: Date | string;
  rateLimits?: Partial<AuthRateLimitConfig>;
  logger?: FastifyServerOptions['logger'];
}

export interface TestServer {
  app: ReturnType<typeof buildServer>;
  store: InMemoryAuthStore;
  clock: TestClock;
  notifier: CapturingPasswordResetNotifier;
  limiter: RateLimiter;
  config: AuthConfig;
  /**
   * An `AuthService` over the same store, for tests that compose guards on
   * test-only routes. It resolves the same sessions as the routes registered by
   * `buildServer`, because both read the shared in-memory store.
   */
  guardService: AuthService;
  close(): Promise<void>;
}

export function createTestServer(options: TestServerOptions = {}): TestServer {
  const store = createInMemoryAuthStore();
  const clock = createTestClock(options.start ?? TEST_START);
  const notifier = createCapturingPasswordResetNotifier();
  const limiter = createInMemoryRateLimiter();

  const config: AuthConfig = {
    cookie: {
      name: SESSION_COOKIE_NAME,
      secret: TEST_SESSION_SECRET,
      // Secure cookies are covered by config.test.ts; plain HTTP keeps the
      // in-process test client simple.
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAgeSeconds: 3_600,
    },
    sessionTtlMs: 60 * 60 * 1000,
    passwordResetTtlMs: 30 * 60 * 1000,
    passwordResetUrl: 'http://localhost:3000/account/reset-password',
    rateLimits: { ...AUTH_RATE_LIMITS, ...options.rateLimits },
  };

  const app = buildServer({
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    auth: {
      store,
      clock,
      notifier,
      limiter,
      config,
      hasher: createArgon2idPasswordHasher(TEST_ARGON2ID_PARAMS),
    },
  });

  const guardService = new AuthService({
    store,
    clock,
    notifier,
    hasher: createArgon2idPasswordHasher(TEST_ARGON2ID_PARAMS),
    sessionTtlMs: config.sessionTtlMs,
  });

  return {
    app,
    store,
    clock,
    notifier,
    limiter,
    config,
    guardService,
    close: () => app.close(),
  };
}

type ResponseWithCookies = { cookies: ReadonlyArray<{ name: string; value: string }> };

/** Turns the session cookie of a response into a `Cookie` request header. */
export function sessionCookieHeader(server: TestServer, response: ResponseWithCookies): string {
  const cookie = response.cookies.find((entry) => entry.name === server.config.cookie.name);

  if (cookie === undefined) {
    throw new Error('The response did not set a session cookie.');
  }

  return `${cookie.name}=${cookie.value}`;
}

export interface RegisteredUser {
  userId: string;
  cookie: string;
  token: string;
}

/** Registers a user through the API and returns its session cookie. */
export async function registerUser(
  server: TestServer,
  email: string = TEST_EMAIL,
  password: string = TEST_PASSWORD,
): Promise<RegisteredUser> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password, name: 'Ada' },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Registration failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json<{ data: { user: { id: string } } }>();
  const cookie = sessionCookieHeader(server, response);

  return { userId: body.data.user.id, cookie, token: cookie.split('=').slice(1).join('=') };
}

/** Logs in through the API and returns the new session cookie. */
export async function loginUser(
  server: TestServer,
  email: string = TEST_EMAIL,
  password: string = TEST_PASSWORD,
): Promise<RegisteredUser> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Login failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json<{ data: { user: { id: string } } }>();
  const cookie = sessionCookieHeader(server, response);

  return { userId: body.data.user.id, cookie, token: cookie.split('=').slice(1).join('=') };
}
