/**
 * Email normalization and validation.
 *
 * Accounts are identified by email, and `User.email` is unique in PostgreSQL
 * with a case-sensitive comparison. Normalizing here (trim + lower-case) means
 * `Ada@Example.com` and `ada@example.com` cannot become two accounts, and it
 * keeps the rule in one place instead of relying on every caller.
 *
 * The database is deliberately left alone: lower-casing in the application is
 * enough for a locale-independent comparison and avoids a `citext` dependency
 * (see docs/DECISIONS.md, D-030).
 */

/** RFC 5321 practical upper bound for an email address. */
const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Canonical form used for storage and lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Conservative structural check.
 *
 * Deliberately strict enough to reject obviously malformed input, but not an
 * attempt at full RFC validation: deliverability is proven by sending mail, not
 * by a regular expression.
 */
export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}
