/**
 * Rate limiting for the authentication endpoints, as a Fastify preHandler.
 *
 * The limiter itself lives in `@ruangnode/auth` (in-process, per-instance); this
 * module only decides which keys a request consumes. Login and password reset are
 * limited twice: once per client address and once per hashed account identifier,
 * so neither a single address probing many accounts nor a distributed attack
 * against one account is unthrottled.
 *
 * The raw email address is never used as a key: it is hashed first, so limiter
 * state contains no personal data.
 */
import {
  hashSecretToken,
  tooManyAttemptsError,
  type RateLimiter,
  type RateLimitRule,
} from '@ruangnode/auth';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

export interface RateLimitPreHandlerOptions {
  limiter: RateLimiter;
  rule: RateLimitRule;
  /** Namespace so rules for different endpoints never share a bucket. */
  scope: string;
  /**
   * Extracts a stable account identifier from an already-validated body.
   * The value is hashed before it is used as a key.
   */
  accountIdentifier?: (request: FastifyRequest) => string | null;
}

function clientAddress(request: FastifyRequest): string {
  // `trustProxy` is enabled, so this is the client address as reported by the
  // reverse proxy, not the proxy's own address.
  return request.ip === '' ? 'unknown' : request.ip;
}

/** Reads a string `email` field from an already-validated request body. */
export function emailFromBody(request: FastifyRequest): string | null {
  const body: unknown = request.body;

  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const email = (body as { email?: unknown }).email;

  return typeof email === 'string' && email !== '' ? email : null;
}

export function createRateLimitPreHandler(
  options: RateLimitPreHandlerOptions,
): preHandlerHookHandler {
  // Declared `async` on purpose: Fastify's hook runner only continues for hooks
  // that either take a `done` callback or return a promise. A plain synchronous
  // hook would leave the request pending.
  return async (request: FastifyRequest, reply) => {
    const now = new Date();
    const keys = [`${options.scope}:ip:${clientAddress(request)}`];
    const account = options.accountIdentifier?.(request);

    if (account !== null && account !== undefined && account !== '') {
      keys.push(`${options.scope}:account:${hashSecretToken(account.trim().toLowerCase())}`);
    }

    for (const key of keys) {
      const decision = options.limiter.consume(key, options.rule, now);

      if (!decision.allowed) {
        reply.header('Retry-After', String(decision.retryAfterSeconds));
        throw tooManyAttemptsError(decision.retryAfterSeconds);
      }
    }
  };
}
