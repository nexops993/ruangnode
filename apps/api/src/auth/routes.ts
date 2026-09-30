/**
 * Authentication routes.
 *
 * Handlers stay thin: validate (schema) → guard (preHandler) → service → respond.
 * All domain logic lives in `@ruangnode/auth`, so this module contains no
 * password, session or authorization rules.
 *
 * Endpoints (docs/API.md → Authentication):
 *
 *   POST   /api/v1/auth/register
 *   POST   /api/v1/auth/login
 *   POST   /api/v1/auth/logout
 *   GET    /api/v1/auth/me
 *   GET    /api/v1/auth/sessions
 *   DELETE /api/v1/auth/sessions/:id
 *   POST   /api/v1/auth/sessions/revoke-all
 *   POST   /api/v1/auth/password/reset/request
 *   POST   /api/v1/auth/password/reset/confirm
 *
 * Responses follow docs/API.md's success envelope (`{ data }`); failures use the
 * shared error envelope. The session token is only ever sent in the cookie.
 */
import {
  AUTH_MESSAGES,
  toPublicSession,
  type AuthService,
  type LoginInput,
  type PasswordResetConfirmInput,
  type PasswordResetRequestInput,
  type RateLimiter,
  type RegisterInput,
  type RequestMetadata,
} from '@ruangnode/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AuthRateLimitConfig, SessionCookieConfig } from './config.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './cookies.js';
import { authContextOf, requireAuth } from './guards.js';
import { createRateLimitPreHandler, emailFromBody } from './rate-limit.js';
import {
  currentUserRouteSchema,
  listSessionsRouteSchema,
  loginRouteSchema,
  logoutRouteSchema,
  passwordResetConfirmRouteSchema,
  passwordResetRequestRouteSchema,
  registerRouteSchema,
  revokeOtherSessionsRouteSchema,
  revokeSessionRouteSchema,
} from './schemas.js';

export const AUTH_ROUTE_PREFIX = '/api/v1/auth';

/** Shown after a completed reset. Does not reveal anything about the account. */
export const PASSWORD_RESET_COMPLETED_MESSAGE =
  'Your password has been updated. Sign in again with your new password.';

const MAX_USER_AGENT_LENGTH = 512;

export interface AuthRoutesOptions {
  auth: AuthService;
  cookie: SessionCookieConfig;
  limiter: RateLimiter;
  rateLimits: AuthRateLimitConfig;
}

/**
 * Request metadata recorded with sessions and audit events.
 *
 * The client address comes from the proxy-aware `request.ip`; the user agent is
 * bounded so a client cannot store unbounded data in the database.
 */
function requestMetadata(request: FastifyRequest): RequestMetadata {
  const userAgent = request.headers['user-agent'];

  return {
    ipAddress: request.ip === '' ? null : request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
): Promise<void> {
  const { auth, cookie, limiter, rateLimits } = options;
  const requireAuthenticated = requireAuth({ auth, cookie });

  // Authentication responses are per-user and must never be cached by a proxy or
  // the browser.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith(AUTH_ROUTE_PREFIX)) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  app.post(
    '/register',
    {
      schema: registerRouteSchema,
      preHandler: createRateLimitPreHandler({
        limiter,
        rule: rateLimits.register,
        scope: 'auth:register',
        accountIdentifier: emailFromBody,
      }),
    },
    async (request, reply) => {
      const body = request.body as RegisterInput;
      const result = await auth.register(
        { email: body.email, password: body.password, name: body.name ?? null },
        requestMetadata(request),
      );

      setSessionCookie(reply, result.session.token, cookie);

      return reply.status(201).send({ data: { user: result.user } });
    },
  );

  app.post(
    '/login',
    {
      schema: loginRouteSchema,
      preHandler: createRateLimitPreHandler({
        limiter,
        rule: rateLimits.login,
        scope: 'auth:login',
        accountIdentifier: emailFromBody,
      }),
    },
    async (request, reply) => {
      const body = request.body as LoginInput;
      const result = await auth.login(
        { email: body.email, password: body.password },
        requestMetadata(request),
      );

      setSessionCookie(reply, result.session.token, cookie);

      return reply.status(200).send({ data: { user: result.user } });
    },
  );

  // Logout is idempotent and does not require a valid session: the cookie is
  // always cleared and the session (if any) is revoked.
  app.post('/logout', { schema: logoutRouteSchema }, async (request, reply) => {
    const token = readSessionToken(request, cookie);

    if (token !== null) {
      await auth.logout(token, requestMetadata(request));
    }

    clearSessionCookie(reply, cookie);

    return reply.status(204).send();
  });

  app.get(
    '/me',
    { schema: currentUserRouteSchema, preHandler: requireAuthenticated },
    (request) => ({ data: { user: authContextOf(request).user } }),
  );

  app.get(
    '/sessions',
    { schema: listSessionsRouteSchema, preHandler: requireAuthenticated },
    async (request) => {
      const context = authContextOf(request);
      const sessions = await auth.sessions.listActive(context.user.id);

      return {
        data: {
          sessions: sessions.map((session) => toPublicSession(session, context.sessionId)),
        },
      };
    },
  );

  app.delete(
    '/sessions/:id',
    { schema: revokeSessionRouteSchema, preHandler: requireAuthenticated },
    async (request, reply) => {
      const context = authContextOf(request);
      const { id } = request.params as { id: string };

      await auth.revokeSession(context.user.id, id, requestMetadata(request));

      // Revoking the session that made the request ends this browser session.
      if (id === context.sessionId) {
        clearSessionCookie(reply, cookie);
      }

      return reply.status(204).send();
    },
  );

  app.post(
    '/sessions/revoke-all',
    { schema: revokeOtherSessionsRouteSchema, preHandler: requireAuthenticated },
    async (request) => {
      const context = authContextOf(request);
      const revokedCount = await auth.revokeOtherSessions(
        context.user.id,
        context.sessionId,
        requestMetadata(request),
      );

      return { data: { revokedCount } };
    },
  );

  // The response is identical whether or not the account exists.
  app.post(
    '/password/reset/request',
    {
      schema: passwordResetRequestRouteSchema,
      preHandler: createRateLimitPreHandler({
        limiter,
        rule: rateLimits.passwordResetRequest,
        scope: 'auth:password-reset-request',
        accountIdentifier: emailFromBody,
      }),
    },
    async (request, reply) => {
      const body = request.body as PasswordResetRequestInput;

      await auth.requestPasswordReset({ email: body.email }, requestMetadata(request));

      return reply.status(202).send({ data: { message: AUTH_MESSAGES.passwordResetRequested } });
    },
  );

  app.post(
    '/password/reset/confirm',
    {
      schema: passwordResetConfirmRouteSchema,
      preHandler: createRateLimitPreHandler({
        limiter,
        rule: rateLimits.passwordResetConfirm,
        scope: 'auth:password-reset-confirm',
      }),
    },
    async (request, reply) => {
      const body = request.body as PasswordResetConfirmInput;

      await auth.confirmPasswordReset(
        { token: body.token, password: body.password },
        requestMetadata(request),
      );

      // A reset revokes every session, so the current cookie is no longer valid.
      clearSessionCookie(reply, cookie);

      return reply.status(200).send({ data: { message: PASSWORD_RESET_COMPLETED_MESSAGE } });
    },
  );
}
