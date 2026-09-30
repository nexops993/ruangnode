/**
 * Reusable authentication and authorization guards.
 *
 * These are thin HTTP adapters: they resolve the session cookie, attach the
 * authenticated context to the request and delegate every decision to the pure
 * policy functions in `@ruangnode/auth`. No authorization rule is implemented
 * here, so the same rules apply to any future caller (services, admin tooling).
 *
 * Usage:
 *
 *     app.get('/api/v1/auth/me', { preHandler: requireAuth(auth) }, handler)
 *     app.get('/admin/thing', { preHandler: [requireAuth(auth), requireRole('ADMIN')] }, handler)
 */
import {
  assertOwnedResourceAccess,
  assertRole,
  authenticationRequiredError,
  hiddenResourceError,
  type AuthActor,
  type AuthService,
  type OwnershipOptions,
  type PublicUser,
  type Role,
} from '@ruangnode/auth';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import type { SessionCookieConfig } from './config.js';
import { readSessionToken } from './cookies.js';

/** Authenticated request context. Contains no token and no password hash. */
export interface AuthenticatedContext {
  user: PublicUser;
  actor: AuthActor;
  sessionId: string;
  sessionExpiresAt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after `requireAuth` succeeded. */
    auth?: AuthenticatedContext;
  }
}

/**
 * Returns the authenticated context, or throws 401.
 *
 * Handlers use this instead of reading `request.auth` directly, so a route that
 * forgot its guard fails closed.
 */
export function authContextOf(request: FastifyRequest): AuthenticatedContext {
  if (request.auth === undefined) {
    throw authenticationRequiredError();
  }

  return request.auth;
}

export interface AuthGuardDependencies {
  auth: AuthService;
  cookie: SessionCookieConfig;
}

/** Resolves the session cookie into `request.auth`, or throws 401. */
export function requireAuth(dependencies: AuthGuardDependencies): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const token = readSessionToken(request, dependencies.cookie);

    if (token === null) {
      throw authenticationRequiredError();
    }

    const authenticated = await dependencies.auth.authenticate(token);

    if (authenticated === null) {
      throw authenticationRequiredError();
    }

    request.auth = {
      user: {
        id: authenticated.user.id,
        email: authenticated.user.email,
        name: authenticated.user.name,
        role: authenticated.user.role,
        status: authenticated.user.status,
      },
      actor: {
        id: authenticated.user.id,
        role: authenticated.user.role,
        status: authenticated.user.status,
      },
      sessionId: authenticated.session.id,
      sessionExpiresAt: authenticated.session.expiresAt.toISOString(),
    };
  };
}

/**
 * Requires one of `roles`.
 *
 * Must run after `requireAuth`; without an authenticated context the request is
 * rejected with 401 rather than treated as authorized.
 */
export function requireRole(...roles: readonly Role[]): preHandlerHookHandler {
  // `async` keeps Fastify's hook runner in promise mode (see rate-limit.ts).
  return async (request: FastifyRequest) => {
    assertRole(authContextOf(request).actor, roles);
  };
}

/**
 * Requires ownership of a customer-owned resource.
 *
 * `resolveOwnerUserId` loads the resource's owner from the database using an
 * identifier from the URL — never an identifier from the body — and returns
 * `null` when the resource does not exist. A resource that exists but belongs to
 * somebody else is reported as 404 by default (see `assertOwnedResourceAccess`),
 * so the endpoint cannot be used to enumerate other tenants' resources.
 */
export function requireOwnership(
  resolveOwnerUserId: (request: FastifyRequest) => Promise<string | null>,
  options: OwnershipOptions = {},
): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const context = authContextOf(request);
    const ownerUserId = await resolveOwnerUserId(request);

    if (ownerUserId === null) {
      throw hiddenResourceError();
    }

    assertOwnedResourceAccess(context.actor, ownerUserId, options);
  };
}
