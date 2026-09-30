/**
 * Capturing password-reset notifier.
 *
 * Records what would have been sent so tests can complete a reset flow. It keeps
 * the value in memory only: it must never write the token to a log, a file or a
 * response (docs/SECURITY.md → Secrets).
 */
import type { PasswordResetNotification, PasswordResetNotifier } from '../ports.js';

export interface CapturingPasswordResetNotifier extends PasswordResetNotifier {
  /** Notifications in send order. */
  notifications(): PasswordResetNotification[];
  /** Most recent notification, or `null`. */
  latest(): PasswordResetNotification | null;
  clear(): void;
}

export function createCapturingPasswordResetNotifier(): CapturingPasswordResetNotifier {
  const captured: PasswordResetNotification[] = [];

  return {
    async send(notification: PasswordResetNotification) {
      captured.push(notification);
    },

    notifications: () => [...captured],
    latest: () => captured.at(-1) ?? null,
    clear: () => {
      captured.length = 0;
    },
  };
}
