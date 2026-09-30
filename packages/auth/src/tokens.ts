/**
 * Bearer-secret handling.
 *
 * Session tokens and password-reset tokens are generated here and only ever
 * stored as a SHA-256 hash. The plaintext value exists exactly once: in the
 * cookie the browser holds, or in the reset link that is delivered out of band.
 * Neither the plaintext nor its hash may be logged or returned by an API.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits of entropy, base64url encoded (43 characters). */
const TOKEN_BYTES = 32;

/**
 * Generates a new opaque bearer token.
 *
 * `randomBytes` is the CSPRNG; tokens are never derived from user data, time or
 * a counter.
 */
export function generateSecretToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hashes a bearer token for storage and lookup.
 *
 * A plain SHA-256 (not a password hash) is correct here: the input is a
 * high-entropy random value, and the digest must be stable so it can be used as
 * a unique index key.
 */
export function hashSecretToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compares two secrets without leaking their content through timing.
 *
 * Used to re-verify a recomputed token hash against the stored one. Length is
 * compared first, which is not sensitive because hashes have a fixed length.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
