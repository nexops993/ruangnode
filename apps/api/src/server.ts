import {
  AuthService,
  createArgon2idPasswordHasher,
  createInMemoryRateLimiter,
  NullPasswordResetNotifier,
  systemClock,
  type AuthServiceOptions,
  type AuthStore,
  type Clock,
  type PasswordHasher,
  type PasswordResetNotifier,
  type RateLimiter,
} from '@ruangnode/auth';
import cookie from '@fastify/cookie';
import { AppError, isAppError, toErrorResponse } from '@ruangnode/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { authConfigFromEnv, type AuthConfig } from './auth/config.js';
import { AUTH_ROUTE_PREFIX, registerAuthRoutes } from './auth/routes.js';
import { registerCommerceRoutes, type CommerceRoutesOptions } from './commerce/routes.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInfrastructureRoutes, type InfrastructureRoutesOptions } from './infrastructure/routes.js';
import { isValidationError, validationError } from './validation.js';

/**
 * Authentication dependencies.
 *
 * The process entrypoint wires the real implementations (Prisma store, Argon2id
 * hasher, in-process rate limiter). Tests inject the in-memory store from
 * `@ruangnode/auth/testing`, which is the only supported way to run the API
 * without a database.
 */
export interface AuthModuleOptions {
  /** Persistence for users, sessions, reset tokens and audit events. */
  store: AuthStore;
  /** Argon2id hasher. Defaults to the production parameters. */
  hasher?: PasswordHasher;
  /** Password-reset delivery. Defaults to the not-implemented-yet notifier. */
  notifier?: PasswordResetNotifier;
  /** Injectable time source, for tests. */
  clock?: Clock;
  /** Overrides individual service settings (session/reset lifetimes). */
  serviceOptions?: Partial<Omit<AuthServiceOptions, 'store' | 'hasher' | 'notifier' | 'clock'>>;
  /** Authentication configuration (cookie settings, lifetimes, rate limits). */
  config?: AuthConfig;
  /** Rate limiter. Defaults to a fresh in-process limiter. */
  limiter?: RateLimiter;
}

export interface BuildServerOptions {
  /**
   * Enable Fastify request logging. Disabled by default so that tests and
   * in-process callers stay quiet; the process entrypoint enables it.
   */
  logger?: FastifyServerOptions['logger'];
  /**
   * Authentication wiring.
   *
   * When omitted the authentication routes are not registered at all (they
   * answer 404) and a warning is logged. `apps/api/src/index.ts` always provides
   * it, so a deployed process can never run without authentication.
   */
  auth?: AuthModuleOptions;
  /**
   * Commerce wiring (catalog, resource profiles and orders).
   *
   * The composed domain services are injected; the API layer never receives a
   * database client. Commerce routes also need the authentication service for
   * their guards, so they are registered only together with `auth`.
   */
  commerce?: CommerceModuleOptions;
  infrastructure?: InfrastructureRoutesOptions;
}

/**
 * Options of the commerce module: the composed domain services.
 */
export interface CommerceModuleOptions {
  services: CommerceRoutesOptions['services'];
}

/**
 * Builds the control plane API instance.
 *
 * The instance is returned before it is listening so that tests can drive it
 * in-process with `app.inject()` and so that deployment code can decide how to
 * listen. Route modules are registered here; business logic belongs in
 * `@ruangnode/services`, never in route handlers.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // Public traffic terminates at Cloudflare / the reverse proxy, so the
    // forwarded client address is the authoritative one.
    trustProxy: true,
  });

  app.setErrorHandler((error, request, reply) => {
    // Schema-validation failures are reported through the shared envelope
    // instead of Fastify's own error shape.
    if (isValidationError(error)) {
      const validationFailure = validationError(error);

      request.log.info(
        { err: error, status: validationFailure.httpStatus },
        'Request failed schema validation',
      );

      void reply.status(validationFailure.httpStatus).send(toErrorResponse(validationFailure).body);

      return;
    }

    const { status, body } = toErrorResponse(error);

    if (isAppError(error)) {
      // Expected failure: the message is safe to return, but log the detail.
      request.log.info({ err: error, status }, 'Request failed with a structured error');
    } else {
      // Unexpected failure: full detail stays on the server.
      request.log.error({ err: error }, 'Unhandled request error');
    }

    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const { status, body } = toErrorResponse(
      AppError.notFound('The requested endpoint does not exist.'),
    );

    void reply.status(status).send(body);
  });

  app.register(registerHealthRoutes);

  if (options.auth !== undefined) {
    const authConfig = options.auth.config ?? safeAuthConfigFromEnv(app);

    if (authConfig === null) {
      app.log.error(
        'Authentication was configured but the configuration is invalid; auth routes are not registered.',
      );
    } else {
      const authService = registerAuthentication(app, options.auth, authConfig);

      registerCommerce(app, authService, authConfig.cookie, options.commerce);
      if (options.infrastructure !== undefined) {
        registerInfrastructureRoutes(app, options.infrastructure, authService, authConfig.cookie);
      }
    }
  } else {
    app.log.warn(
      'Authentication routes are not registered: no authentication module was provided.',
    );

    if (options.commerce !== undefined) {
      // Commerce routes are guarded by the authentication guards, so they must
      // not be reachable on a process that cannot authenticate anybody.
      app.log.warn('Commerce routes are not registered: authentication is unavailable.');
    }
  }

  return app;
}

/**
 * Reads the authentication configuration from the environment.
 *
 * A missing configuration must not take the whole process down at build time
 * (health checks still need to answer), so the failure is logged and
 * authentication is not registered.
 */
function safeAuthConfigFromEnv(app: FastifyInstance): AuthConfig | null {
  try {
    return authConfigFromEnv();
  } catch (error) {
    app.log.error({ err: error }, 'Authentication configuration is invalid');
    return null;
  }
}
/** Builds the authentication service and registers its routes. */
function registerAuthentication(
  app: FastifyInstance,
  auth: AuthModuleOptions,
  config: AuthConfig,
): AuthService {
  const service = new AuthService({
    store: auth.store,
    hasher: auth.hasher ?? createArgon2idPasswordHasher(),
    notifier: auth.notifier ?? new NullPasswordResetNotifier(),
    clock: auth.clock ?? systemClock,
    sessionTtlMs: config.sessionTtlMs,
    passwordResetTtlMs: config.passwordResetTtlMs,
    resetLinkBaseUrl: config.passwordResetUrl,
    ...auth.serviceOptions,
  });

  app.register(cookie, { secret: config.cookie.secret, hook: 'onRequest' });

  app.register(registerAuthRoutes, {
    // All authentication endpoints live under the documented API prefix.
    prefix: AUTH_ROUTE_PREFIX,
    auth: service,
    cookie: config.cookie,
    limiter: auth.limiter ?? createInMemoryRateLimiter(),
    rateLimits: config.rateLimits,
  });

  return service;
}

/**
 * Registers the commerce routes (catalog, resource profiles, orders).
 *
 * The guards need the same `AuthService` instance the authentication routes use,
 * so both modules share one service and one session configuration.
 */
function registerCommerce(
  app: FastifyInstance,
  auth: AuthService,
  cookie: AuthConfig['cookie'],
  commerce: CommerceModuleOptions | undefined,
): void {
  if (commerce === undefined) {
    app.log.warn('Commerce routes are not registered: no commerce module was provided.');

    return;
  }

  registerCommerceRoutes(app, { services: commerce.services, auth, cookie });
}
