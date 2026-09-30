import { afterEach, describe, expect, it } from 'vitest';

import { authContextOf, requireAuth, requireOwnership, requireRole } from './guards.js';
import { createTestServer, registerUser, TEST_EMAIL, type TestServer } from './test-harness.js';

const openServers: TestServer[] = [];

function server(): TestServer {
  const instance = createTestServer();
  openServers.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((instance) => instance.close()));
});

/**
 * Registers the guards on test-only routes.
 *
 * This exercises the real guard factories against the real Fastify request
 * lifecycle, exactly as a future customer or admin route would use them.
 */
function registerGuardRoutes(instance: TestServer, options: { allowSupport?: boolean } = {}): void {
  const guards = { auth: instance.guardService, cookie: instance.config.cookie };

  instance.app.get('/__test__/authenticated', { preHandler: requireAuth(guards) }, (request) => ({
    data: { user: authContextOf(request).user },
  }));

  instance.app.get(
    '/__test__/admin-only',
    { preHandler: [requireAuth(guards), requireRole('ADMIN')] },
    () => ({ data: { scope: 'admin' } }),
  );

  instance.app.get(
    '/__test__/staff',
    { preHandler: [requireAuth(guards), requireRole('SUPPORT', 'ADMIN')] },
    () => ({ data: { scope: 'staff' } }),
  );

  instance.app.get(
    '/__test__/resource/:id',
    {
      preHandler: [
        requireAuth(guards),
        requireOwnership(
          async (request) => {
            const { id } = request.params as { id: string };

            return id === 'missing' ? null : id;
          },
          options.allowSupport === true ? { allowSupport: true } : {},
        ),
      ],
    },
    () => ({ data: { scope: 'resource' } }),
  );
}

describe('requireAuth', () => {
  it('attaches the authenticated context for a valid session', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const registered = await registerUser(instance);

    const response = await instance.app.inject({
      method: 'GET',
      url: '/__test__/authenticated',
      headers: { cookie: registered.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { user: { id: registered.userId, email: TEST_EMAIL, role: 'CUSTOMER' } },
    });
    // The context never carries a token or a hash.
    expect(response.body).not.toContain('tokenHash');
  });

  it('rejects a missing or unknown session', async () => {
    const instance = server();
    registerGuardRoutes(instance);

    const missing = await instance.app.inject({ method: 'GET', url: '/__test__/authenticated' });
    const unknown = await instance.app.inject({
      method: 'GET',
      url: '/__test__/authenticated',
      headers: { cookie: `${instance.config.cookie.name}=not-a-real-cookie-value` },
    });

    expect(missing.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
  });
});

describe('requireRole', () => {
  it('allows the required role and rejects a customer', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const customer = await registerUser(instance);

    const rejected = await instance.app.inject({
      method: 'GET',
      url: '/__test__/admin-only',
      headers: { cookie: customer.cookie },
    });

    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    instance.store.setUserRole(customer.userId, 'ADMIN');

    const allowed = await instance.app.inject({
      method: 'GET',
      url: '/__test__/admin-only',
      headers: { cookie: customer.cookie },
    });

    expect(allowed.statusCode).toBe(200);
  });

  it('lets support reach staff routes but not admin-only routes', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const support = await registerUser(instance);
    instance.store.setUserRole(support.userId, 'SUPPORT');

    const staff = await instance.app.inject({
      method: 'GET',
      url: '/__test__/staff',
      headers: { cookie: support.cookie },
    });
    const adminOnly = await instance.app.inject({
      method: 'GET',
      url: '/__test__/admin-only',
      headers: { cookie: support.cookie },
    });

    expect(staff.statusCode).toBe(200);
    expect(adminOnly.statusCode).toBe(403);
  });

  it('refuses an inactive account even with the right role', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const admin = await registerUser(instance);
    instance.store.setUserRole(admin.userId, 'ADMIN');
    instance.store.setUserStatus(admin.userId, 'SUSPENDED');

    const response = await instance.app.inject({
      method: 'GET',
      url: '/__test__/admin-only',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('requireOwnership', () => {
  it('allows the owner', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const owner = await registerUser(instance);

    const response = await instance.app.inject({
      method: 'GET',
      url: `/__test__/resource/${owner.userId}`,
      headers: { cookie: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('hides a resource owned by another customer', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const owner = await registerUser(instance);
    const other = await registerUser(instance, 'grace@example.com');

    const response = await instance.app.inject({
      method: 'GET',
      url: `/__test__/resource/${owner.userId}`,
      headers: { cookie: other.cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('hides a resource that does not exist', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const owner = await registerUser(instance);

    const response = await instance.app.inject({
      method: 'GET',
      url: '/__test__/resource/missing',
      headers: { cookie: owner.cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lets an admin act on another customer resource', async () => {
    const instance = server();
    registerGuardRoutes(instance);
    const owner = await registerUser(instance);
    const admin = await registerUser(instance, 'admin@example.com');
    instance.store.setUserRole(admin.userId, 'ADMIN');

    const response = await instance.app.inject({
      method: 'GET',
      url: `/__test__/resource/${owner.userId}`,
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('lets support act only where support access is explicitly allowed', async () => {
    const strict = server();
    registerGuardRoutes(strict);
    const support = await registerUser(strict);
    strict.store.setUserRole(support.userId, 'SUPPORT');

    const denied = await strict.app.inject({
      method: 'GET',
      url: '/__test__/resource/someone-else',
      headers: { cookie: support.cookie },
    });
    expect(denied.statusCode).toBe(403);

    const permissive = server();
    registerGuardRoutes(permissive, { allowSupport: true });
    const supportAgent = await registerUser(permissive);
    permissive.store.setUserRole(supportAgent.userId, 'SUPPORT');

    const allowed = await permissive.app.inject({
      method: 'GET',
      url: '/__test__/resource/someone-else',
      headers: { cookie: supportAgent.cookie },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('rejects an anonymous request before evaluating ownership', async () => {
    const instance = server();
    registerGuardRoutes(instance);

    const response = await instance.app.inject({
      method: 'GET',
      url: '/__test__/resource/any-id',
    });

    expect(response.statusCode).toBe(401);
  });
});
