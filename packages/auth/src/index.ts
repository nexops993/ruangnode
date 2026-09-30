/**
 * @ruangnode/auth
 *
 * Boundary: authentication, sessions, password hashing, role checks and
 * ownership enforcement for the control plane.
 *
 * What lives here (Phase 1B):
 *   - `password.ts`        Argon2id hashing and the password policy
 *   - `tokens.ts`          bearer-token generation, hashing and constant-time compare
 *   - `session-service.ts` issue / resolve / revoke database-backed sessions
 *   - `auth-service.ts`    register, login, logout, current user, password reset
 *   - `authorization.ts`   role and ownership policy (pure functions)
 *   - `rate-limit.ts`      in-process rate limiting for authentication endpoints
 *   - `ports.ts`           storage and delivery interfaces (implemented by adapters)
 *   - `adapters/`          the Prisma-backed store used by the control plane
 *   - `testing/`           in-memory store and deterministic clock (via `./testing`)
 *
 * Rules this package implements:
 *   - passwords are Argon2id hashes, never plaintext, never logged
 *   - sessions are database-backed and revocable; only token hashes are stored
 *   - roles are evaluated server-side and are never taken from a request body
 *   - ownership is decided from the authenticated session, and a foreign resource
 *     is reported as not found
 *   - password-reset tokens are single-use, expiring and never returned or logged
 *
 * This package has no HTTP framework dependency: Fastify-specific guards live in
 * `apps/api/src/auth` and delegate their decisions to `authorization.ts`.
 */

export * from './audit.js';
export * from './auth-service.js';
export * from './authorization.js';
export * from './clock.js';
export * from './email.js';
export * from './errors.js';
export * from './notifiers.js';
export * from './password.js';
export * from './ports.js';
export * from './rate-limit.js';
export * from './roles.js';
export * from './session-service.js';
export * from './tokens.js';
export * from './adapters/prisma-auth-store.js';
