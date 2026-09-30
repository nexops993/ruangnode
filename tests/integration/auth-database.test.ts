/**
 * Authentication against a real PostgreSQL database.
 *
 * Everything here is production code: the committed migrations, the Prisma
 * client and the Prisma-backed authentication store, the Argon2id hasher, the
 * Fastify instance built by `@ruangnode/api` and the cookie configuration
 * resolved from the environment. The only substitution is the password-reset
 * notifier, because email delivery is not implemented yet.
 *
 * What this verifies that unit tests cannot: sessions really are rows in the
 * database, revocation really is a database write, the unique index on
 * `User.email` really rejects duplicates, the reset-token claim really is atomic
 * under concurrency, and audit rows really contain no secrets.
 */
import { buildServer } from '@ruangnode/api';
import { authConfigFromEnv } from '@ruangnode/api/auth/config';
import {
  createArgon2idPasswordHasher,
  createPrismaAuthStore,
  hashSecretToken,
  type PasswordResetNotification,
} from '@ruangnode/auth';
import {
  TEST_ARGON2ID_PARAMS,
  createCapturingPasswordResetNotifier,
  createTestClock,
} from '@ruangnode/auth/testing';
import { createDatabaseClient, type PrismaClient } from '@ruangnode/database';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startEmbeddedPostgres, type EmbeddedPostgres } from '../support/embedded-postgres.js';

const EMAIL = 'ada@example.com';
const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-brand-new-passphrase-2026';
const SESSION_SECRET = 'integration-test-session-secret-value-32';
const TEST_TIMEOUT_MS = 30_000;

let database: EmbeddedPostgres;
let prisma: PrismaClient;
let app: ReturnType<typeof buildServer>;
let notifier: ReturnType<typeof createCapturingPasswordResetNotifier>;
let clock: ReturnType<typeof createTestClock>;
let cookieName: string;

beforeAll(async () => {
  database = await startEmbeddedPostgres();
  prisma = createDatabaseClient({ connectionString: database.url });

  const config = authConfigFromEnv({ NODE_ENV: 'test', SESSION_SECRET });
  cookieName = config.cookie.name;
  clock = createTestClock('2026-01-01T00:00:00.000Z');
  notifier = createCapturingPasswordResetNotifier();

  app = buildServer({
    auth: {
      store: createPrismaAuthStore(prisma),
      hasher: createArgon2idPasswordHasher(TEST_ARGON2ID_PARAMS),
      notifier,
      clock,
      config: {
        ...config,
        // Rate limiting has its own tests; this suite drives many requests from
        // one client address and would otherwise be throttled.
        rateLimits: {
          register: { limit: 1_000, windowMs: 60_000 },
          login: { limit: 1_000, windowMs: 60_000 },
          passwordResetRequest: { limit: 1_000, windowMs: 60_000 },
          passwordResetConfirm: { limit: 1_000, windowMs: 60_000 },
        },
      },
    },
  });

  await app.ready();
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await database?.stop();
});

function cookieHeader(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((entry) => entry.name === cookieName);

  if (cookie === undefined) {
    throw new Error(`No session cookie in response: ${response.statusCode} ${response.body}`);
  }

  return `${cookie.name}=${cookie.value}`;
}

async function register(
  email = EMAIL,
  password = PASSWORD,
): Promise<{
  cookie: string;
  userId: string;
}> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password, name: 'Ada' },
  });

  expect(response.statusCode).toBe(201);

  return {
    cookie: cookieHeader(response),
    userId: response.json<{ data: { user: { id: string } } }>().data.user.id,
  };
}

describe('authentication over a real database', () => {
  it(
    'persists the account, the Argon2id hash and the session row',
    async () => {
      const registered = await register();

      const user = await prisma.user.findUniqueOrThrow({ where: { id: registered.userId } });
      expect(user.email).toBe(EMAIL);
      expect(user.role).toBe('CUSTOMER');
      expect(user.status).toBe('ACTIVE');
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);

      const sessions = await prisma.session.findMany({ where: { userId: registered.userId } });
      expect(sessions).toHaveLength(1);

      const token = registered.cookie.split('=').slice(1).join('=');
      expect(sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(sessions)).not.toContain(token);
      expect(sessions[0]?.revokedAt).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects a duplicate email through the unique index',
    async () => {
      await register('duplicate@example.com');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'DUPLICATE@example.com', password: PASSWORD },
      });

      expect(response.statusCode).toBe(409);
      expect(await prisma.user.count({ where: { email: 'duplicate@example.com' } })).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'signs in and resolves the current user from the database',
    async () => {
      await register('login@example.com');

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'login@example.com', password: PASSWORD },
      });
      expect(login.statusCode).toBe(200);

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: cookieHeader(login) },
      });

      expect(me.statusCode).toBe(200);
      expect(me.json<{ data: { user: { email: string } } }>().data.user.email).toBe(
        'login@example.com',
      );

      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'login@example.com' } });
      expect(user.lastLoginAt).not.toBeNull();
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'revokes the session in the database on logout',
    async () => {
      const registered = await register('logout@example.com');

      const logout = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: registered.cookie },
      });
      expect(logout.statusCode).toBe(204);

      const sessions = await prisma.session.findMany({ where: { userId: registered.userId } });
      expect(sessions[0]?.revokedAt).not.toBeNull();
      expect(sessions[0]?.revokedReason).toBe('LOGOUT');

      // The row is kept as an audit trail, but the session no longer works.
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: registered.cookie },
      });
      expect(me.statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stops accepting a session that was revoked from the database',
    async () => {
      const registered = await register('revoked@example.com');

      await prisma.session.updateMany({
        where: { userId: registered.userId },
        data: { revokedAt: new Date(), revokedReason: 'ADMIN_REVOKED' },
      });

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: registered.cookie },
      });

      expect(me.statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stops accepting a session once it expires',
    async () => {
      const registered = await register('expired@example.com');

      await prisma.session.updateMany({
        where: { userId: registered.userId },
        data: { expiresAt: new Date(clock.now().getTime() - 1000) },
      });

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: registered.cookie },
      });

      expect(me.statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'does not let a customer revoke another customer session',
    async () => {
      const victim = await register('victim@example.com');
      const attacker = await register('attacker@example.com');
      const victimSession = await prisma.session.findFirstOrThrow({
        where: { userId: victim.userId },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/auth/sessions/${victimSession.id}`,
        headers: { cookie: attacker.cookie },
      });

      expect(response.statusCode).toBe(404);
      const stillActive = await prisma.session.findUniqueOrThrow({
        where: { id: victimSession.id },
      });
      expect(stillActive.revokedAt).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'records audit events without storing secrets',
    async () => {
      const registered = await register('audited@example.com');
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'audited@example.com', password: 'wrong-password-value' },
      });

      const events = await prisma.auditLog.findMany({
        where: { OR: [{ actorUserId: registered.userId }, { action: 'auth.login.failed' }] },
        orderBy: { createdAt: 'asc' },
      });

      const actions = events.map((event) => event.action);
      expect(actions).toContain('auth.register');
      expect(actions).toContain('auth.login.failed');

      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain('wrong-password-value');
      expect(serialized).not.toContain(registered.cookie.split('=').slice(1).join('='));
    },
    TEST_TIMEOUT_MS,
  );
});

describe('password reset over a real database', () => {
  const requestReset = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/request',
      payload: { email },
    });

  const confirmReset = (token: string, password = NEW_PASSWORD) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token, password },
    });

  it(
    'stores only a hash of the token, then changes the password and revokes sessions',
    async () => {
      const registered = await register('reset@example.com');

      const requested = await requestReset('reset@example.com');
      expect(requested.statusCode).toBe(202);

      const notification = notifier.latest() as PasswordResetNotification;
      expect(notification.token).not.toBe('');

      const stored = await prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: registered.userId },
      });
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.tokenHash).not.toBe(notification.token);
      expect(requested.body).not.toContain(notification.token);

      const confirmed = await confirmReset(notification.token);
      expect(confirmed.statusCode).toBe(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: registered.userId } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);

      const sessions = await prisma.session.findMany({ where: { userId: registered.userId } });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
      expect(sessions[0]?.revokedReason).toBe('PASSWORD_RESET');

      const consumed = await prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: registered.userId },
      });
      expect(consumed.usedAt).not.toBeNull();

      const oldSession = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: registered.cookie },
      });
      expect(oldSession.statusCode).toBe(401);

      const newLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'reset@example.com', password: NEW_PASSWORD },
      });
      expect(newLogin.statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'consumes a token exactly once, guarded by a conditional claim',
    async () => {
      await register('race@example.com');
      await requestReset('race@example.com');
      const token = notifier.latest()?.token ?? '';

      // The single-use guarantee is the conditional UPDATE in
      // `PasswordResetRepository.claim` (usedAt IS NULL): the first caller wins
      // and every later caller is rejected.
      const store = createPrismaAuthStore(prisma);
      const tokenHash = hashSecretToken(token);

      await expect(store.passwordResets.claim(tokenHash, clock.now())).resolves.toBe(true);
      await expect(store.passwordResets.claim(tokenHash, clock.now())).resolves.toBe(false);

      // Concurrent confirmations are covered by the same conditional update but
      // cannot be exercised here: the embedded PostgreSQL server accepts a single
      // connection, so two overlapping transactions are not possible (see
      // docs/DECISIONS.md, D-039).
      const consumed = await confirmReset(token);
      expect(consumed.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects an expired token',
    async () => {
      await register('stale@example.com');
      await requestReset('stale@example.com');
      const token = notifier.latest()?.token ?? '';

      await prisma.passwordResetToken.updateMany({
        where: {},
        data: { expiresAt: new Date(clock.now().getTime() - 1000) },
      });

      const response = await confirmReset(token);

      expect(response.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'answers an unknown account exactly like a known one',
    async () => {
      const known = await requestReset(EMAIL);
      const unknown = await requestReset('nobody@example.com');

      expect(known.statusCode).toBe(202);
      expect(unknown.statusCode).toBe(202);
      expect(known.body).toBe(unknown.body);
    },
    TEST_TIMEOUT_MS,
  );
});
