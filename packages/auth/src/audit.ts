/**
 * Audit events for authentication and security changes.
 *
 * Actions are stable machine-readable names written to `AuditLog` (see
 * `docs/SECURITY.md` → Audit logging). Metadata must never contain a password,
 * a session token, a reset token or any other secret; `assertAuditMetadataIsSafe`
 * enforces that at the point where an event is recorded.
 */
export const AUDIT_ACTIONS = {
  register: 'auth.register',
  loginSucceeded: 'auth.login.succeeded',
  loginFailed: 'auth.login.failed',
  logout: 'auth.logout',
  sessionRevoked: 'auth.session.revoked',
  sessionsRevokedAll: 'auth.sessions.revoked_all',
  passwordResetRequested: 'auth.password.reset.requested',
  passwordResetCompleted: 'auth.password.reset.completed',
  passwordResetRejected: 'auth.password.reset.rejected',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Resource types referenced by authentication audit events. */
export const AUDIT_RESOURCE_TYPES = {
  user: 'User',
  session: 'Session',
} as const;

export type AuditMetadataValue = string | number | boolean | null;

export type AuditMetadata = Record<string, AuditMetadataValue>;

/**
 * Metadata keys that would indicate a secret is being persisted.
 *
 * Matched case-insensitively against the key name, so `sessionToken`,
 * `password_hash` and `resetToken` are all rejected.
 */
const FORBIDDEN_METADATA_KEY_PATTERN = /pass|secret|token|hash|credential|key/i;

/**
 * Fails fast when audit metadata looks like it contains a secret.
 *
 * This is a programming-error guard, not a sanitizer: silently dropping the
 * value would hide the bug. Audit writes are part of the request, so a
 * violation surfaces immediately in development and in tests.
 */
export function assertAuditMetadataIsSafe(metadata: AuditMetadata | undefined): void {
  if (metadata === undefined) {
    return;
  }

  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_METADATA_KEY_PATTERN.test(key)) {
      throw new Error(
        `Refusing to write audit metadata key "${key}": secrets must never be persisted in audit logs.`,
      );
    }
  }
}
