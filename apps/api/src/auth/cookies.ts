/**
 * Session cookie handling.
 *
 * The cookie carries the opaque session token and is the only place the
 * plaintext token exists on the client side. Settings:
 *
 *   - `httpOnly`   the token is unreadable from JavaScript, so an XSS bug cannot
 *                  exfiltrate a session
 *   - `secure`     HTTPS-only outside local development
 *   - `sameSite=lax` blocks cross-site POSTs (CSRF) while keeping normal
 *                  top-level navigation working
 *   - `path=/`     required by the `__Host-` prefix
 *   - `signed`     the value is HMAC-signed with `SESSION_SECRET`, so a tampered
 *                  cookie is rejected before it reaches the database
 *
 * The token is never accepted from a query string or a header: authentication
 * tokens do not belong in URLs, where they leak through logs and referrers.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { SessionCookieConfig } from './config.js';

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  config: SessionCookieConfig,
): void {
  reply.setCookie(config.name, token, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: config.path,
    maxAge: config.maxAgeSeconds,
    signed: true,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: SessionCookieConfig): void {
  reply.clearCookie(config.name, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: config.path,
    signed: true,
  });
}

/**
 * Reads the session token from the cookie.
 *
 * Returns `null` when the cookie is absent, malformed or fails signature
 * verification; the caller then answers 401 without touching the database.
 */
export function readSessionToken(
  request: FastifyRequest,
  config: SessionCookieConfig,
): string | null {
  const raw = request.cookies[config.name];

  if (typeof raw !== 'string' || raw === '') {
    return null;
  }

  const unsigned = request.unsignCookie(raw);

  return unsigned.valid ? unsigned.value : null;
}
