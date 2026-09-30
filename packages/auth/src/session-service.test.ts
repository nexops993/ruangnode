import { describe, expect, it } from 'vitest';

import { MINUTE_MS } from './clock.js';
import { SessionService } from './session-service.js';
import { captureAppError } from './testing/app-error.js';
import { createTestClock } from './testing/clock.js';
import { createInMemoryAuthStore } from './testing/in-memory-store.js';

const START = '2026-01-01T00:00:00.000Z';
const REQUEST_METADATA = { ipAddress: '203.0.113.10', userAgent: 'vitest' };
const DAY_MS = 24 * 60 * 60 * 1000;

async function createFixture() {
  const store = createInMemoryAuthStore();
  const clock = createTestClock(START);
  const service = new SessionService({ store, clock });
  const user = await store.users.create({
    email: 'ada@example.com',
    name: 'Ada',
    passwordHash: 'argon2id-placeholder',
    role: 'CUSTOMER',
  });

  return { store, clock, service, user };
}

describe('SessionService.issue', () => {
  it('returns the token once and stores only its hash', async () => {
    const { store, service, user } = await createFixture();

    const issued = await service.issue(user.id, REQUEST_METADATA);
    const [session] = store.inspectSessions();

    expect(issued.token).not.toBe('');
    expect(session?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session?.tokenHash).not.toBe(issued.token);
    expect(JSON.stringify(store.inspectSessions())).not.toContain(issued.token);
  });

  it('expires the session after the configured lifetime', async () => {
    const { clock, service, user } = await createFixture();

    const issued = await service.issue(user.id, REQUEST_METADATA);

    expect(issued.expiresAt.getTime() - clock.now().getTime()).toBe(30 * DAY_MS);
  });

  it('records the request context with the session', async () => {
    const { store, service, user } = await createFixture();

    await service.issue(user.id, REQUEST_METADATA);

    expect(store.inspectSessions()[0]).toMatchObject({
      userId: user.id,
      ipAddress: '203.0.113.10',
      userAgent: 'vitest',
    });
  });
});

describe('SessionService.authenticate', () => {
  it('resolves a valid session to its user', async () => {
    const { service, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);

    const authenticated = await service.authenticate(issued.token);

    expect(authenticated?.user.id).toBe(user.id);
    expect(authenticated?.session.id).toBe(issued.sessionId);
  });

  it('rejects unknown, empty and malformed tokens', async () => {
    const { service } = await createFixture();

    await expect(service.authenticate('')).resolves.toBeNull();
    await expect(service.authenticate('   ')).resolves.toBeNull();
    await expect(service.authenticate('not-a-real-token')).resolves.toBeNull();
  });

  it('rejects an expired session', async () => {
    const { clock, service, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);

    clock.advance(31 * DAY_MS);

    await expect(service.authenticate(issued.token)).resolves.toBeNull();
  });

  it('rejects a revoked session', async () => {
    const { service, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);

    await service.revokeByToken(issued.token, 'LOGOUT');

    await expect(service.authenticate(issued.token)).resolves.toBeNull();
  });

  it('rejects and revokes the session of an account that is no longer active', async () => {
    const { store, service, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);

    store.setUserStatus(user.id, 'SUSPENDED');

    await expect(service.authenticate(issued.token)).resolves.toBeNull();
    expect(store.inspectSessions()[0]?.revokedAt).not.toBeNull();
    expect(store.inspectSessions()[0]?.revokedReason).toBe('ADMIN_REVOKED');
  });

  it('updates lastUsedAt at most once per throttle window', async () => {
    const { clock, service, store, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);
    const initialLastUsedAt = store.inspectSessions()[0]?.lastUsedAt.getTime() ?? 0;

    clock.advance(MINUTE_MS);
    await service.authenticate(issued.token);
    expect(store.inspectSessions()[0]?.lastUsedAt.getTime()).toBe(initialLastUsedAt);

    clock.advance(10 * MINUTE_MS);
    await service.authenticate(issued.token);
    expect(store.inspectSessions()[0]?.lastUsedAt.getTime()).toBeGreaterThan(initialLastUsedAt);
  });
});

describe('session revocation', () => {
  it('revokes a session by token, idempotently', async () => {
    const { service, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);

    await expect(service.revokeByToken(issued.token, 'LOGOUT')).resolves.toBe(true);
    await expect(service.revokeByToken(issued.token, 'LOGOUT')).resolves.toBe(false);
  });

  it('revokes a session the caller owns', async () => {
    const { service, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);

    await service.revokeOwnedSession(issued.sessionId, user.id, 'LOGOUT');

    await expect(service.authenticate(issued.token)).resolves.toBeNull();
  });

  it('hides a session that belongs to somebody else', async () => {
    const { service, store, user } = await createFixture();
    const other = await store.users.create({
      email: 'grace@example.com',
      name: null,
      passwordHash: 'argon2id-placeholder',
      role: 'CUSTOMER',
    });
    const issued = await service.issue(user.id, REQUEST_METADATA);

    const error = await captureAppError(
      service.revokeOwnedSession(issued.sessionId, other.id, 'LOGOUT'),
    );

    expect(error.code).toBe('NOT_FOUND');
    await expect(service.authenticate(issued.token)).resolves.not.toBeNull();
  });

  it('hides an unknown session id', async () => {
    const { service, user } = await createFixture();

    const error = await captureAppError(
      service.revokeOwnedSession(crypto.randomUUID(), user.id, 'LOGOUT'),
    );

    expect(error.code).toBe('NOT_FOUND');
  });

  it('lists only active sessions and revokes every other session', async () => {
    const { service, user } = await createFixture();
    const first = await service.issue(user.id, REQUEST_METADATA);
    const second = await service.issue(user.id, REQUEST_METADATA);
    const current = await service.issue(user.id, REQUEST_METADATA);

    await expect(service.listActive(user.id)).resolves.toHaveLength(3);
    await expect(service.revokeOthers(user.id, current.sessionId, 'LOGOUT_ALL')).resolves.toBe(2);

    const active = await service.listActive(user.id);
    expect(active.map((session) => session.id)).toEqual([current.sessionId]);
    await expect(service.authenticate(first.token)).resolves.toBeNull();
    await expect(service.authenticate(second.token)).resolves.toBeNull();
    await expect(service.authenticate(current.token)).resolves.not.toBeNull();
  });

  it('revokes every session, including the current one', async () => {
    const { service, user } = await createFixture();
    const issued = await service.issue(user.id, REQUEST_METADATA);

    await expect(service.revokeAll(user.id, 'PASSWORD_RESET')).resolves.toBe(1);
    await expect(service.authenticate(issued.token)).resolves.toBeNull();
  });

  it('does not list expired sessions as active', async () => {
    const { clock, service, user } = await createFixture();
    await service.issue(user.id, REQUEST_METADATA);

    clock.advance(31 * DAY_MS);

    await expect(service.listActive(user.id)).resolves.toEqual([]);
  });
});
