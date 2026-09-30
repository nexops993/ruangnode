/**
 * Password-reset delivery.
 *
 * Email delivery is not implemented yet (it arrives with transactional email in
 * a later phase). The port exists now so the reset flow is complete and testable
 * without pretending that a message was sent: `NullPasswordResetNotifier` does
 * nothing, and the test suite wires the capturing notifier from
 * `@ruangnode/auth/testing`.
 *
 * No implementation may log the token (docs/SECURITY.md → Secrets).
 */
import type { PasswordResetNotification, PasswordResetNotifier } from './ports.js';

/**
 * Does nothing.
 *
 * Used by the API until an email adapter is wired: a reset token is created and
 * stored, but no message is delivered. That is an explicit, documented gap
 * rather than a fake success.
 */
export class NullPasswordResetNotifier implements PasswordResetNotifier {
  async send(_notification: PasswordResetNotification): Promise<void> {
    // Intentionally empty: delivery is not implemented yet.
  }
}

/** Builds the URL a customer follows to complete a reset. */
export function buildPasswordResetUrl(baseUrl: string, token: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';

  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}
