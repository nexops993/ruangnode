/**
 * Authorization policy.
 *
 * Pure functions over an authenticated actor: no database access, no framework,
 * no hidden state. Guards in the API layer translate the outcome into an HTTP
 * response; services and future admin tooling use the same rules.
 *
 * Two rules matter for tenant isolation (`.clinerules` → Multi-tenant security):
 *
 *   1. a customer may only act on resources they own, and ownership is decided
 *      from the authenticated session, never from an identifier supplied by the
 *      browser;
 *   2. when a resource exists but belongs to somebody else, the default answer is
 *      "not found", so the API cannot be used to enumerate other tenants' data.
 */
import { insufficientRoleError, hiddenResourceError } from './errors.js';
import type { AuthUser } from './ports.js';
import { isAccountActive, type AccountStatus, type Role } from './roles.js';

/** The authenticated principal an authorization decision is made for. */
export interface AuthActor {
  id: string;
  role: Role;
  status: AccountStatus;
}

export function actorFromUser(user: AuthUser): AuthActor {
  return { id: user.id, role: user.role, status: user.status };
}

export function hasRole(actor: AuthActor, role: Role): boolean {
  return actor.role === role;
}

export function hasAnyRole(actor: AuthActor, roles: readonly Role[]): boolean {
  return roles.includes(actor.role);
}

export function isAdmin(actor: AuthActor): boolean {
  return actor.role === 'ADMIN';
}

/**
 * Throws unless the actor holds one of `roles`.
 *
 * Also refuses actors whose account is no longer active, so a suspended account
 * cannot act even if it somehow holds a valid session.
 */
export function assertRole(
  actor: AuthActor,
  roles: readonly Role[],
  options: { message?: string } = {},
): void {
  if (!isAccountActive(actor.status) || !hasAnyRole(actor, roles)) {
    throw insufficientRoleError(options.message);
  }
}

export type OwnershipOutcome = 'OWNER' | 'ADMIN' | 'SUPPORT' | 'NOT_OWNER' | 'ROLE_NOT_PERMITTED';

export interface OwnershipOptions {
  /**
   * Whether SUPPORT staff may act on this resource type. Support access is
   * opt-in per resource type (docs/SECURITY.md → Authorization) instead of a
   * blanket bypass.
   */
  allowSupport?: boolean;
  /** Return 403 instead of 404 when the resource belongs to someone else. */
  revealExistence?: boolean;
}

/**
 * Evaluates whether an actor may act on a resource owned by `ownerUserId`.
 *
 * Ownership always wins: an admin acting on their own resource is reported as
 * `OWNER`.
 */
export function evaluateOwnership(
  actor: AuthActor,
  ownerUserId: string,
  options: OwnershipOptions = {},
): OwnershipOutcome {
  if (!isAccountActive(actor.status)) {
    return 'ROLE_NOT_PERMITTED';
  }

  if (actor.id === ownerUserId) {
    return 'OWNER';
  }

  if (actor.role === 'ADMIN') {
    return 'ADMIN';
  }

  if (actor.role === 'SUPPORT') {
    return options.allowSupport === true ? 'SUPPORT' : 'ROLE_NOT_PERMITTED';
  }

  return 'NOT_OWNER';
}

export function canAccessOwnedResource(
  actor: AuthActor,
  ownerUserId: string,
  options: OwnershipOptions = {},
): boolean {
  const outcome = evaluateOwnership(actor, ownerUserId, options);

  return outcome === 'OWNER' || outcome === 'ADMIN' || outcome === 'SUPPORT';
}

/**
 * Throws unless the actor may act on a resource owned by `ownerUserId`.
 *
 * - a role failure (for example SUPPORT without an explicit permission) is a 403:
 *   the actor's role, not the resource, is the problem
 * - a resource that exists but belongs to another customer is reported as not
 *   found (404) by default, so the endpoint cannot be used to enumerate other
 *   tenants' resources; pass `revealExistence: true` only where the resource is
 *   already public knowledge
 */
export function assertOwnedResourceAccess(
  actor: AuthActor,
  ownerUserId: string,
  options: OwnershipOptions = {},
): OwnershipOutcome {
  const outcome = evaluateOwnership(actor, ownerUserId, options);

  if (outcome === 'OWNER' || outcome === 'ADMIN' || outcome === 'SUPPORT') {
    return outcome;
  }

  if (outcome === 'ROLE_NOT_PERMITTED') {
    throw insufficientRoleError();
  }

  throw options.revealExistence === true ? insufficientRoleError() : hiddenResourceError();
}
