import { describe, expect, it } from 'vitest';

import {
  assertOwnedResourceAccess,
  assertRole,
  canAccessOwnedResource,
  evaluateOwnership,
  hasAnyRole,
} from './authorization.js';
import type { AuthActor } from './authorization.js';
import { isPrivilegedRole } from './roles.js';
import { captureAppError } from './testing/app-error.js';

const CUSTOMER: AuthActor = { id: 'user-customer', role: 'CUSTOMER', status: 'ACTIVE' };
const OTHER_CUSTOMER: AuthActor = { id: 'user-other', role: 'CUSTOMER', status: 'ACTIVE' };
const SUPPORT: AuthActor = { id: 'user-support', role: 'SUPPORT', status: 'ACTIVE' };
const ADMIN: AuthActor = { id: 'user-admin', role: 'ADMIN', status: 'ACTIVE' };
const SUSPENDED_ADMIN: AuthActor = { id: 'user-suspended', role: 'ADMIN', status: 'SUSPENDED' };

describe('role checks', () => {
  it('accepts an actor holding one of the required roles', () => {
    expect(() => assertRole(ADMIN, ['ADMIN'])).not.toThrow();
    expect(() => assertRole(SUPPORT, ['SUPPORT', 'ADMIN'])).not.toThrow();
  });

  it('rejects an actor that does not hold the required role', async () => {
    const error = await captureAppError(
      Promise.resolve().then(() => assertRole(CUSTOMER, ['ADMIN'])),
    );

    expect(error.code).toBe('FORBIDDEN');
  });

  it('rejects a privileged role that is not the required one', async () => {
    const error = await captureAppError(
      Promise.resolve().then(() => assertRole(SUPPORT, ['ADMIN'])),
    );

    expect(error.code).toBe('FORBIDDEN');
  });

  it('rejects an inactive actor even when the role matches', async () => {
    const error = await captureAppError(
      Promise.resolve().then(() => assertRole(SUSPENDED_ADMIN, ['ADMIN'])),
    );

    expect(error.code).toBe('FORBIDDEN');
  });

  it('reports role membership', () => {
    expect(hasAnyRole(SUPPORT, ['SUPPORT'])).toBe(true);
    expect(hasAnyRole(CUSTOMER, ['SUPPORT', 'ADMIN'])).toBe(false);
    expect(isPrivilegedRole('ADMIN')).toBe(true);
    expect(isPrivilegedRole('SUPPORT')).toBe(true);
    expect(isPrivilegedRole('CUSTOMER')).toBe(false);
  });
});

describe('ownership checks', () => {
  it('allows the owner', () => {
    expect(evaluateOwnership(CUSTOMER, CUSTOMER.id)).toBe('OWNER');
    expect(canAccessOwnedResource(CUSTOMER, CUSTOMER.id)).toBe(true);
  });

  it('denies a customer who does not own the resource', () => {
    expect(evaluateOwnership(OTHER_CUSTOMER, CUSTOMER.id)).toBe('NOT_OWNER');
    expect(canAccessOwnedResource(OTHER_CUSTOMER, CUSTOMER.id)).toBe(false);
  });

  it('hides the existence of a foreign resource by default', async () => {
    const error = await captureAppError(
      Promise.resolve().then(() => assertOwnedResourceAccess(OTHER_CUSTOMER, CUSTOMER.id)),
    );

    expect(error.code).toBe('NOT_FOUND');
  });

  it('can reveal existence when the caller asks for it', async () => {
    const error = await captureAppError(
      Promise.resolve().then(() =>
        assertOwnedResourceAccess(OTHER_CUSTOMER, CUSTOMER.id, { revealExistence: true }),
      ),
    );

    expect(error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to act on any resource', () => {
    expect(evaluateOwnership(ADMIN, CUSTOMER.id)).toBe('ADMIN');
    expect(canAccessOwnedResource(ADMIN, CUSTOMER.id)).toBe(true);
  });

  it('prefers ownership over privilege when the admin owns the resource', () => {
    expect(evaluateOwnership(ADMIN, ADMIN.id)).toBe('OWNER');
  });

  it('allows support only when support access is explicitly enabled', () => {
    expect(evaluateOwnership(SUPPORT, CUSTOMER.id)).toBe('ROLE_NOT_PERMITTED');
    expect(canAccessOwnedResource(SUPPORT, CUSTOMER.id)).toBe(false);
    expect(evaluateOwnership(SUPPORT, CUSTOMER.id, { allowSupport: true })).toBe('SUPPORT');
    expect(canAccessOwnedResource(SUPPORT, CUSTOMER.id, { allowSupport: true })).toBe(true);
  });

  it('denies an inactive actor regardless of role', () => {
    expect(canAccessOwnedResource(SUSPENDED_ADMIN, CUSTOMER.id)).toBe(false);
  });

  it('never treats an unknown actor id as the owner', () => {
    expect(canAccessOwnedResource(CUSTOMER, '')).toBe(false);
  });
});
