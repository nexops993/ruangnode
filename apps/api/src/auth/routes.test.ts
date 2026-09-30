import { AUTH_MESSAGES } from '@ruangnode/auth';
import type { ErrorResponseBody } from '@ruangnode/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { PASSWORD_RESET_COMPLETED_MESSAGE } from './routes.js';
import {
  createTestServer,
  loginUser,
  registerUser,
  sessionCookieHeader,
  TEST_EMAIL,
  TEST_NEW_PASSWORD,
  TEST_PASSWORD,
  TEST_SESSION_SECRET,
  type TestServer,
} from './test-harness.js';

const openServers: TestServer[] = [];

function server(options: Parameters<typeof createTestServer>[0] = {}): TestServer {
  const instance = createTestServer(options);
  openServers.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((instance) => instance.close()));
});

interface UserBody {
  data: { user: { id: string; email: string; name: string | null; role: string; status: string } };
}

describe('POST /api/v1/auth/register', () => {
  it('creates an account, signs it in and sets a hardened session cookie', async () => {
    const instance = server();

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD, name: 'Ada' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<UserBody>().data.user).toEqual({
      id: expect.any(String),
      email: TEST_EMAIL,
      name: 'Ada',
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });

    const cookie = response.cookies.find((entry) => entry.name === instance.config.cookie.name);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('never returns the password hash or the session token in the body', async () => {
    const instance = server();

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    const token = sessionCookieHeader(instance, response).split('=').slice(1).join('=');

    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('argon2');
    expect(response.body).not.toContain(TEST_PASSWORD);
    expect(response.body).not.toContain(token);
  });

  it('rejects a duplicate email address with 409', async () => {
    const instance = server();
    await registerUser(instance);

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'ADA@example.com', password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponseBody>().error.code).toBe('CONFLICT');
    expect(instance.store.inspectUsers()).toHaveLength(1);
  });

  it('rejects invalid input with 422 through the shared error envelope', async () => {
    const instance = server();

    const tooShort = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: TEST_EMAIL, password: 'short' },
    });
    const malformedEmail = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: TEST_PASSWORD },
    });
    const missingField = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: TEST_EMAIL },
    });

    for (const response of [tooShort, malformedEmail, missingField]) {
      expect(response.statusCode).toBe(422);
      expect(response.json<ErrorResponseBody>().error.code).toBe('VALIDATION_FAILED');
    }

    expect(tooShort.json<ErrorResponseBody>().error.message).toContain('password');
    expect(tooShort.body).not.toContain('short');
  });

  it('rejects unknown fields, including an attempted role escalation', async () => {
    const instance = server();

    // Fastify's AJV defaults remove properties that are not in the schema
    // (`removeAdditional`), so a smuggled `role` never reaches the service.
    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD, role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<UserBody>().data.user.role).toBe('CUSTOMER');
    expect(instance.store.inspectUsers()[0]?.role).toBe('CUSTOMER');
    expect(response.body).not.toContain('ADMIN');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('signs in with the correct password', async () => {
    const instance = server();
    await registerUser(instance);

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserBody>().data.user.email).toBe(TEST_EMAIL);
    expect(
      response.cookies.find((entry) => entry.name === instance.config.cookie.name)?.httpOnly,
    ).toBe(true);
  });

  it('answers a wrong password and an unknown account identically', async () => {
    const instance = server();
    await registerUser(instance);

    const wrongPassword = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: TEST_EMAIL, password: 'definitely-not-the-password' },
    });
    const unknownAccount = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: TEST_PASSWORD },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    expect(wrongPassword.body).toBe(unknownAccount.body);
    expect(wrongPassword.json<ErrorResponseBody>().error).toEqual({
      code: 'UNAUTHORIZED',
      message: AUTH_MESSAGES.invalidCredentials,
      retryable: false,
    });
  });

  it('refuses an inactive account with the same generic error', async () => {
    const instance = server();
    const registered = await registerUser(instance);
    instance.store.setUserStatus(registered.userId, 'DISABLED');

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorResponseBody>().error.message).toBe(AUTH_MESSAGES.invalidCredentials);
  });

  it('rate limits repeated attempts with a Retry-After header', async () => {
    const instance = server({ rateLimits: { login: { limit: 2, windowMs: 60_000 } } });
    await registerUser(instance);

    const attempt = () =>
      instance.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: TEST_EMAIL, password: 'wrong-password-value' },
      });

    await attempt();
    await attempt();

    const blocked = await attempt();

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ErrorResponseBody>().error.code).toBe('RATE_LIMITED');
    expect(blocked.json<ErrorResponseBody>().error.retryable).toBe(true);
    expect(blocked.headers['retry-after']).toBe('60');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user for a valid session', async () => {
    const instance = server();
    const registered = await registerUser(instance);

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: registered.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserBody>().data.user).toMatchObject({
      id: registered.userId,
      email: TEST_EMAIL,
      role: 'CUSTOMER',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects a request without a session cookie', async () => {
    const instance = server();

    const response = await instance.app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorResponseBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a tampered cookie before trusting its contents', async () => {
    const instance = server();
    const registered = await registerUser(instance);
    const [name, value = ''] = registered.cookie.split('=');
    const tampered = `${name}=${value.slice(0, -2)}xy`;

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: tampered },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a revoked session', async () => {
    const instance = server();
    const registered = await registerUser(instance);

    await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: registered.cookie },
    });

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: registered.cookie },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const instance = server();
    const registered = await registerUser(instance);

    instance.clock.advance(2 * 60 * 60 * 1000);

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: registered.cookie },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const instance = server();
    const registered = await registerUser(instance);

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: registered.cookie },
    });

    expect(response.statusCode).toBe(204);
    const cleared = response.cookies.find((entry) => entry.name === instance.config.cookie.name);
    expect(cleared?.value).toBe('');
    expect(instance.store.inspectSessions()[0]?.revokedAt).not.toBeNull();
  });

  it('is idempotent without a session', async () => {
    const instance = server();

    const response = await instance.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });

    expect(response.statusCode).toBe(204);
  });
});

describe('session management', () => {
  it('lists the caller sessions without exposing token hashes', async () => {
    const instance = server();
    const first = await registerUser(instance);
    const second = await loginUser(instance);

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: second.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { sessions: Array<{ id: string; current: boolean }> } }>();

    expect(body.data.sessions).toHaveLength(2);
    expect(body.data.sessions.filter((session) => session.current)).toHaveLength(1);
    expect(response.body).not.toContain('tokenHash');
    expect(response.body).not.toContain(first.token);
    expect(response.body).not.toContain(second.token);
  });

  it('revokes another session of the same user', async () => {
    const instance = server();
    const first = await registerUser(instance);
    const second = await loginUser(instance);
    const listed = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: second.cookie },
    });
    const other = listed
      .json<{ data: { sessions: Array<{ id: string; current: boolean }> } }>()
      .data.sessions.find((session) => !session.current);

    const response = await instance.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${other?.id ?? ''}`,
      headers: { cookie: second.cookie },
    });

    expect(response.statusCode).toBe(204);
    const revoked = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: first.cookie },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it('hides a session that belongs to another user', async () => {
    const instance = server();
    await registerUser(instance);
    const victim = await loginUser(instance);
    const attacker = await registerUser(instance, 'grace@example.com');
    const victimSessions = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: victim.cookie },
    });
    const victimSessionId =
      victimSessions.json<{ data: { sessions: Array<{ id: string }> } }>().data.sessions[0]?.id ??
      '';

    const response = await instance.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${victimSessionId}`,
      headers: { cookie: attacker.cookie },
    });

    expect(response.statusCode).toBe(404);
    const stillValid = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: victim.cookie },
    });
    expect(stillValid.statusCode).toBe(200);
  });

  it('revokes every other session and keeps the current one', async () => {
    const instance = server();
    await registerUser(instance);
    const current = await loginUser(instance);
    await loginUser(instance);

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-all',
      headers: { cookie: current.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { revokedCount: number } }>().data.revokedCount).toBe(2);

    const stillValid = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: current.cookie },
    });
    expect(stillValid.statusCode).toBe(200);
  });
});

describe('password reset', () => {
  const resetRequest = (instance: TestServer, email: string) =>
    instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/request',
      payload: { email },
    });

  it('answers identically for an existing and an unknown account', async () => {
    const instance = server();
    await registerUser(instance);

    const existing = await resetRequest(instance, TEST_EMAIL);
    const unknown = await resetRequest(instance, 'nobody@example.com');

    expect(existing.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(existing.body).toBe(unknown.body);
    expect(existing.json<{ data: { message: string } }>().data.message).toBe(
      AUTH_MESSAGES.passwordResetRequested,
    );
    expect(instance.notifier.notifications()).toHaveLength(1);
  });

  it('never returns the reset token in the response', async () => {
    const instance = server();
    await registerUser(instance);

    const response = await resetRequest(instance, TEST_EMAIL);
    const token = instance.notifier.latest()?.token ?? '';

    expect(token).not.toBe('');
    expect(response.body).not.toContain(token);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects malformed input before doing any work', async () => {
    const instance = server();

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/request',
      payload: { email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(422);
    expect(instance.notifier.notifications()).toEqual([]);
  });

  it('completes the flow, revokes sessions and accepts the token only once', async () => {
    const instance = server();
    const registered = await registerUser(instance);
    await resetRequest(instance, TEST_EMAIL);
    const token = instance.notifier.latest()?.token ?? '';

    const confirmed = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token, password: TEST_NEW_PASSWORD },
    });

    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<{ data: { message: string } }>().data.message).toBe(
      PASSWORD_RESET_COMPLETED_MESSAGE,
    );

    const oldSession = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: registered.cookie },
    });
    expect(oldSession.statusCode).toBe(401);

    const newLogin = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_NEW_PASSWORD },
    });
    expect(newLogin.statusCode).toBe(200);

    const reused = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token, password: 'yet-another-passphrase' },
    });
    expect(reused.statusCode).toBe(400);
    expect(reused.json<ErrorResponseBody>().error.message).toBe(AUTH_MESSAGES.invalidResetToken);
  });

  it('rejects an expired token', async () => {
    const instance = server();
    await registerUser(instance);
    await resetRequest(instance, TEST_EMAIL);
    const token = instance.notifier.latest()?.token ?? '';

    instance.clock.advance(31 * 60 * 1000);

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token, password: TEST_NEW_PASSWORD },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown token', async () => {
    const instance = server();

    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token: 'a-token-that-was-never-issued', password: TEST_NEW_PASSWORD },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rate limits repeated reset requests', async () => {
    const instance = server({
      rateLimits: { passwordResetRequest: { limit: 1, windowMs: 60_000 } },
    });

    await resetRequest(instance, TEST_EMAIL);
    const blocked = await resetRequest(instance, TEST_EMAIL);

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('60');
  });
});

describe('secret handling', () => {
  it('never logs a password, a session token or a reset token', async () => {
    const lines: string[] = [];
    const instance = server({
      logger: {
        level: 'trace',
        stream: { write: (line: string) => lines.push(line) },
      },
    });

    const registered = await registerUser(instance);
    await loginUser(instance);
    await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/request',
      payload: { email: TEST_EMAIL },
    });
    const resetToken = instance.notifier.latest()?.token ?? '';
    await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token: resetToken, password: TEST_NEW_PASSWORD },
    });
    await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: TEST_EMAIL, password: 'wrong-password-value' },
    });

    const logs = lines.join('\n');
    const sessionToken = registered.cookie.split('=').slice(1).join('=');

    expect(logs).not.toBe('');
    expect(logs).not.toContain(TEST_PASSWORD);
    expect(logs).not.toContain(TEST_NEW_PASSWORD);
    expect(logs).not.toContain(resetToken);
    expect(logs).not.toContain(sessionToken);
    expect(logs).not.toContain(instance.store.inspectSessions()[0]?.tokenHash ?? 'x');
    expect(logs).not.toContain(TEST_SESSION_SECRET);
  });

  it('keeps session tokens out of the database in plaintext', async () => {
    const instance = server();
    const registered = await registerUser(instance);
    const token = registered.cookie.split('=').slice(1).join('=');

    expect(JSON.stringify(instance.store.inspectSessions())).not.toContain(token);
    expect(instance.store.inspectSessions()[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
