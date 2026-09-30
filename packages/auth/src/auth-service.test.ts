import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from './audit.js';
import { AuthService, type RegisterInput } from './auth-service.js';
import { MINUTE_MS } from './clock.js';
import { DEFAULT_PASSWORD_POLICY } from './password.js';
import type { AuthStore } from './ports.js';
import { captureAppError } from './testing/app-error.js';
import { createTestClock } from './testing/clock.js';
import { createCapturingPasswordResetNotifier } from './testing/notifier.js';
import { createInMemoryAuthStore, type InMemoryAuthStore } from './testing/in-memory-store.js';
import { createArgon2idPasswordHasher } from './password.js';
import { hashSecretToken } from './tokens.js';

const START = '2026-01-01T00:00:00.000Z';
const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-brand-new-passphrase-2026';
const METADATA = { ipAddress: '203.0.113.7', userAgent: 'vitest' };

interface Fixture {
  store: InMemoryAuthStore;
  clock: ReturnType<typeof createTestClock>;
  notifier: ReturnType<typeof createCapturingPasswordResetNotifier>;
  service: AuthService;
}

function createFixture(store: AuthStore = createInMemoryAuthStore()): Fixture {
  const clock = createTestClock(START);
  const notifier = createCapturingPasswordResetNotifier();
  const service = new AuthService({
    store,
    clock,
    notifier,
    hasher: createArgon2idPasswordHasher({
      memoryCostKib: 4_096,
      timeCost: 1,
      parallelism: 1,
      outputLen: 32,
    }),
  });

  return { store: store as InMemoryAuthStore, clock, notifier, service };
}

async function registerAda(fixture: Fixture, email = 'ada@example.com') {
  return fixture.service.register({ email, password: PASSWORD, name: 'Ada' }, METADATA);
}

describe('AuthService.register', () => {
  it('creates an active customer and signs it in', async () => {
    const fixture = createFixture();

    const result = await registerAda(fixture);

    expect(result.user).toMatchObject({ email: 'ada@example.com', name: 'Ada', role: 'CUSTOMER' });
    expect(result.user.status).toBe('ACTIVE');
    expect(result.session.token).not.toBe('');
    await expect(fixture.service.authenticate(result.session.token)).resolves.not.toBeNull();
  });

  it('stores only an Argon2id hash of the password', async () => {
    const fixture = createFixture();

    await registerAda(fixture);
    const [user] = fixture.store.inspectUsers();

    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(PASSWORD);
    expect(JSON.stringify(fixture.store.inspectUsers())).not.toContain(PASSWORD);
  });

  it('normalizes the email address', async () => {
    const fixture = createFixture();

    const result = await registerAda(fixture, '  Ada@Example.COM  ');

    expect(result.user.email).toBe('ada@example.com');
  });

  it('rejects a duplicate email address', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    const error = await captureAppError(registerAda(fixture, 'ADA@example.com'));

    expect(error.code).toBe('CONFLICT');
    expect(fixture.store.inspectUsers()).toHaveLength(1);
  });

  it('rejects a malformed email address', async () => {
    const fixture = createFixture();

    const error = await captureAppError(
      fixture.service.register({ email: 'not-an-email', password: PASSWORD }, METADATA),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a password that violates the policy', async () => {
    const fixture = createFixture();

    const error = await captureAppError(
      fixture.service.register(
        { email: 'ada@example.com', password: 'a'.repeat(DEFAULT_PASSWORD_POLICY.minLength - 1) },
        METADATA,
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain(String(DEFAULT_PASSWORD_POLICY.minLength));
  });

  it('never accepts a role from the request', async () => {
    const fixture = createFixture();

    // A caller trying to smuggle privilege through the registration payload.
    const input = {
      email: 'ada@example.com',
      password: PASSWORD,
      role: 'ADMIN',
    } as unknown as RegisterInput;

    const result = await fixture.service.register(input, METADATA);

    expect(result.user.role).toBe('CUSTOMER');
    expect(fixture.store.inspectUsers()[0]?.role).toBe('CUSTOMER');
  });

  it('records an audit event for the registration', async () => {
    const fixture = createFixture();

    const result = await registerAda(fixture);

    expect(fixture.store.inspectAuditEvents()).toEqual([
      expect.objectContaining({
        action: AUDIT_ACTIONS.register,
        actorUserId: result.user.id,
        resourceType: 'User',
        ipAddress: '203.0.113.7',
      }),
    ]);
  });
});

describe('AuthService.login', () => {
  it('signs in with the correct password and records the login', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    const result = await fixture.service.login(
      { email: 'ada@example.com', password: PASSWORD },
      METADATA,
    );

    expect(result.user.email).toBe('ada@example.com');
    await expect(fixture.service.authenticate(result.session.token)).resolves.not.toBeNull();
    expect(fixture.store.inspectUsers()[0]?.lastLoginAt).toEqual(fixture.clock.now());
    expect(fixture.store.inspectAuditEvents().map((event) => event.action)).toContain(
      AUDIT_ACTIONS.loginSucceeded,
    );
  });

  it('accepts the email address in any case', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    await expect(
      fixture.service.login({ email: 'ADA@EXAMPLE.COM', password: PASSWORD }, METADATA),
    ).resolves.toMatchObject({ user: { email: 'ada@example.com' } });
  });

  it('rejects a wrong password without revealing that the account exists', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    const error = await captureAppError(
      fixture.service.login(
        { email: 'ada@example.com', password: 'wrong-password-value' },
        METADATA,
      ),
    );

    expect(error.code).toBe('UNAUTHORIZED');
    // The message must not disclose which of the two inputs was wrong.
    expect(error.message).toBe('The email address or password is incorrect.');
    expect(error.message).not.toContain('wrong-password-value');
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.loginFailed,
      metadata: { reason: 'INVALID_PASSWORD' },
    });
  });

  it('answers an unknown account with the same error as a wrong password', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    const unknown = await captureAppError(
      fixture.service.login({ email: 'nobody@example.com', password: PASSWORD }, METADATA),
    );
    const wrongPassword = await captureAppError(
      fixture.service.login(
        { email: 'ada@example.com', password: 'wrong-password-value' },
        METADATA,
      ),
    );

    expect(unknown.code).toBe(wrongPassword.code);
    expect(unknown.message).toBe(wrongPassword.message);
    expect(fixture.store.inspectAuditEvents()).toContainEqual(
      expect.objectContaining({
        action: AUDIT_ACTIONS.loginFailed,
        actorUserId: null,
        metadata: { reason: 'UNKNOWN_ACCOUNT', emailKnown: false },
      }),
    );
  });

  it('rejects a suspended account with the same generic error', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);
    fixture.store.setUserStatus(registered.user.id, 'SUSPENDED');

    const error = await captureAppError(
      fixture.service.login({ email: 'ada@example.com', password: PASSWORD }, METADATA),
    );

    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toBe('The email address or password is incorrect.');
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.loginFailed,
      metadata: { reason: 'ACCOUNT_NOT_ACTIVE' },
    });
  });

  it('rejects a disabled account', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);
    fixture.store.setUserStatus(registered.user.id, 'DISABLED');

    const error = await captureAppError(
      fixture.service.login({ email: 'ada@example.com', password: PASSWORD }, METADATA),
    );

    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an account without a password (external identity only)', async () => {
    const fixture = createFixture();
    await fixture.store.users.create({
      email: 'oidc@example.com',
      name: null,
      passwordHash: null,
      role: 'CUSTOMER',
    });
    fixture.store.setUserStatus(fixture.store.inspectUsers()[0]?.id ?? '', 'ACTIVE');

    const error = await captureAppError(
      fixture.service.login({ email: 'oidc@example.com', password: PASSWORD }, METADATA),
    );

    expect(error.code).toBe('UNAUTHORIZED');
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      metadata: { reason: 'NO_PASSWORD' },
    });
  });

  it('upgrades a hash that was produced with outdated parameters', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);
    const legacyHash = await createArgon2idPasswordHasher({
      memoryCostKib: 1_024,
      timeCost: 1,
      parallelism: 1,
      outputLen: 16,
    }).hash(PASSWORD);

    await fixture.store.users.updatePasswordHash(registered.user.id, legacyHash);

    await fixture.service.login({ email: 'ada@example.com', password: PASSWORD }, METADATA);

    const updated = fixture.store.inspectUsers()[0]?.passwordHash ?? '';
    expect(updated).not.toBe(legacyHash);
    expect(updated).toContain('m=4096');
  });
});

describe('AuthService.logout', () => {
  it('revokes the session and records an audit event', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);

    await fixture.service.logout(registered.session.token, METADATA);

    await expect(fixture.service.authenticate(registered.session.token)).resolves.toBeNull();
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.logout,
      actorUserId: registered.user.id,
      resourceType: 'Session',
    });
  });

  it('is idempotent and ignores unknown tokens', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);

    await fixture.service.logout(registered.session.token, METADATA);

    await expect(
      fixture.service.logout(registered.session.token, METADATA),
    ).resolves.toBeUndefined();
    await expect(fixture.service.logout('unknown-token', METADATA)).resolves.toBeUndefined();
  });
});

describe('AuthService.revokeOtherSessions', () => {
  it('keeps the current session and revokes the others', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);
    const other = await fixture.service.login(
      { email: 'ada@example.com', password: PASSWORD },
      METADATA,
    );

    const revokedCount = await fixture.service.revokeOtherSessions(
      registered.user.id,
      other.session.sessionId,
      METADATA,
    );

    expect(revokedCount).toBe(1);
    await expect(fixture.service.authenticate(registered.session.token)).resolves.toBeNull();
    await expect(fixture.service.authenticate(other.session.token)).resolves.not.toBeNull();
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.sessionsRevokedAll,
    });
  });
});

describe('password reset request', () => {
  it('creates a single-use token and notifies out of band', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    await fixture.service.requestPasswordReset({ email: 'ada@example.com' }, METADATA);

    const notification = fixture.notifier.latest();
    const [record] = fixture.store.inspectPasswordResets();

    expect(notification?.token).toBeTruthy();
    expect(record?.tokenHash).toBe(hashSecretToken(notification?.token ?? ''));
    expect(record?.usedAt).toBeNull();
    expect(record?.expiresAt.getTime()).toBe(fixture.clock.now().getTime() + 60 * MINUTE_MS);
    expect(notification?.resetUrl).toContain(encodeURIComponent(notification?.token ?? ''));
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.passwordResetRequested,
      metadata: { accountFound: true },
    });
  });

  it('does not reveal whether the account exists', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    await expect(
      fixture.service.requestPasswordReset({ email: 'nobody@example.com' }, METADATA),
    ).resolves.toBeUndefined();

    expect(fixture.store.inspectPasswordResets()).toEqual([]);
    expect(fixture.notifier.notifications()).toEqual([]);
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.passwordResetRequested,
      actorUserId: null,
      metadata: { accountFound: false },
    });
  });

  it('does not issue a token for an inactive account', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);
    fixture.store.setUserStatus(registered.user.id, 'SUSPENDED');

    await fixture.service.requestPasswordReset({ email: 'ada@example.com' }, METADATA);

    expect(fixture.store.inspectPasswordResets()).toEqual([]);
    expect(fixture.notifier.notifications()).toEqual([]);
  });

  it('invalidates an earlier outstanding token', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    await fixture.service.requestPasswordReset({ email: 'ada@example.com' }, METADATA);
    const firstToken = fixture.notifier.latest()?.token ?? '';
    fixture.clock.advance(MINUTE_MS);
    await fixture.service.requestPasswordReset({ email: 'ada@example.com' }, METADATA);

    const error = await captureAppError(
      fixture.service.confirmPasswordReset({ token: firstToken, password: NEW_PASSWORD }, METADATA),
    );

    expect(error.code).toBe('BAD_REQUEST');
    await expect(
      fixture.service.confirmPasswordReset(
        { token: fixture.notifier.latest()?.token ?? '', password: NEW_PASSWORD },
        METADATA,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('password reset confirmation', () => {
  async function startReset(fixture: Fixture): Promise<string> {
    await fixture.service.requestPasswordReset({ email: 'ada@example.com' }, METADATA);

    return fixture.notifier.latest()?.token ?? '';
  }

  it('replaces the password, consumes the token and revokes every session', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);
    const token = await startReset(fixture);

    await fixture.service.confirmPasswordReset({ token, password: NEW_PASSWORD }, METADATA);

    expect(fixture.store.inspectPasswordResets()[0]?.usedAt).toEqual(fixture.clock.now());
    await expect(fixture.service.authenticate(registered.session.token)).resolves.toBeNull();
    expect(fixture.store.inspectAuditEvents()).toContainEqual(
      expect.objectContaining({
        action: AUDIT_ACTIONS.passwordResetCompleted,
        actorUserId: registered.user.id,
      }),
    );
    await expect(
      fixture.service.login({ email: 'ada@example.com', password: NEW_PASSWORD }, METADATA),
    ).resolves.toMatchObject({ user: { email: 'ada@example.com' } });
    await expect(
      fixture.service.login({ email: 'ada@example.com', password: PASSWORD }, METADATA),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('accepts a token only once', async () => {
    const fixture = createFixture();
    await registerAda(fixture);
    const token = await startReset(fixture);

    await fixture.service.confirmPasswordReset({ token, password: NEW_PASSWORD }, METADATA);

    const error = await captureAppError(
      fixture.service.confirmPasswordReset(
        { token, password: 'another-passphrase-value' },
        METADATA,
      ),
    );

    expect(error.code).toBe('BAD_REQUEST');
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.passwordResetRejected,
      metadata: { reason: 'ALREADY_USED' },
    });
  });

  it('rejects an expired token', async () => {
    const fixture = createFixture();
    await registerAda(fixture);
    const token = await startReset(fixture);

    fixture.clock.advance(61 * MINUTE_MS);

    const error = await captureAppError(
      fixture.service.confirmPasswordReset({ token, password: NEW_PASSWORD }, METADATA),
    );

    expect(error.code).toBe('BAD_REQUEST');
    expect(fixture.store.inspectAuditEvents().at(-1)).toMatchObject({
      metadata: { reason: 'EXPIRED' },
    });
  });

  it('rejects an unknown token', async () => {
    const fixture = createFixture();
    await registerAda(fixture);

    const error = await captureAppError(
      fixture.service.confirmPasswordReset(
        { token: 'a-token-that-was-never-issued', password: NEW_PASSWORD },
        METADATA,
      ),
    );

    expect(error.code).toBe('BAD_REQUEST');
  });

  it('enforces the password policy before consuming the token', async () => {
    const fixture = createFixture();
    await registerAda(fixture);
    const token = await startReset(fixture);

    const error = await captureAppError(
      fixture.service.confirmPasswordReset({ token, password: 'short' }, METADATA),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(fixture.store.inspectPasswordResets()[0]?.usedAt).toBeNull();
    await expect(
      fixture.service.confirmPasswordReset({ token, password: NEW_PASSWORD }, METADATA),
    ).resolves.toBeUndefined();
  });

  it('rolls the transaction back when a later step fails', async () => {
    const store = createInMemoryAuthStore();
    // The failing step is injected inside the transaction, so the claim that
    // already happened must be rolled back with it.
    const failingStore: AuthStore = {
      ...store,
      transaction: (work) =>
        store.transaction((transaction) =>
          work({
            ...transaction,
            users: {
              ...transaction.users,
              updatePasswordHash: async () => {
                throw new Error('simulated storage failure');
              },
            },
          }),
        ),
    };
    const fixture = createFixture(failingStore);
    await registerAda(fixture);
    const token = await startReset(fixture);

    await expect(
      fixture.service.confirmPasswordReset({ token, password: NEW_PASSWORD }, METADATA),
    ).rejects.toThrow('simulated storage failure');

    // The token claim was rolled back together with the rest of the transaction.
    expect(fixture.store.inspectPasswordResets()[0]?.usedAt).toBeNull();
  });
});

describe('secret handling', () => {
  it('never writes a secret into audit metadata', async () => {
    const fixture = createFixture();
    const registered = await registerAda(fixture);
    await fixture.service.requestPasswordReset({ email: 'ada@example.com' }, METADATA);
    const resetToken = fixture.notifier.latest()?.token ?? '';

    await fixture.service.confirmPasswordReset(
      { token: resetToken, password: NEW_PASSWORD },
      METADATA,
    );
    await fixture.service.logout(registered.session.token, METADATA);
    await captureAppError(
      fixture.service.login({ email: 'ada@example.com', password: 'wrong-password' }, METADATA),
    );

    const serialized = JSON.stringify(fixture.store.inspectAuditEvents());
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(resetToken);
    expect(serialized).not.toContain(registered.session.token);
  });

  it('refuses audit metadata that looks like a secret', async () => {
    const fixture = createFixture();

    await expect(
      fixture.store.audit.record({
        action: AUDIT_ACTIONS.loginSucceeded,
        actorUserId: null,
        resourceType: 'User',
        resourceId: null,
        metadata: { sessionToken: 'leaked-value' },
      }),
    ).rejects.toThrow(/secrets must never be persisted/);
  });

  it('projects a user without the password hash', async () => {
    const fixture = createFixture();

    const result = await registerAda(fixture);

    expect(Object.keys(result.user).sort()).toEqual(['email', 'id', 'name', 'role', 'status']);
    expect(JSON.stringify(result.user)).not.toContain('argon2');
  });
});
