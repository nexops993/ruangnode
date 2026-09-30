/**
 * User-safe authentication errors.
 *
 * Every message here is safe to return to a client: it never reveals whether an
 * account exists, whether a password was wrong or whether a token was expired,
 * consumed or simply unknown (docs/SECURITY.md → authentication, and
 * `.clinerules` → Errors). Internal detail belongs in server logs.
 */
import { AppError } from '@ruangnode/shared';

export const AUTH_MESSAGES = {
  /** Used for unknown accounts, wrong passwords and inactive accounts alike. */
  invalidCredentials: 'The email address or password is incorrect.',
  emailAlreadyRegistered: 'An account with this email address already exists.',
  /** Used for unknown, expired, consumed and malformed reset tokens alike. */
  invalidResetToken: 'This password reset link is invalid or has expired.',
  authenticationRequired: 'Authentication is required.',
  insufficientRole: 'You are not allowed to perform this action.',
  resourceNotFound: 'The requested resource was not found.',
  tooManyAttempts: 'Too many attempts. Please try again later.',
  passwordResetRequested:
    'If an account exists for that email address, a password reset link has been sent.',
} as const;

/**
 * Authentication failure that must not disclose the reason.
 *
 * Returned for: unknown account, account without a password, wrong password and
 * accounts that are not active. The real reason is recorded in the audit log.
 */
export function invalidCredentialsError(): AppError {
  return new AppError({ code: 'UNAUTHORIZED', message: AUTH_MESSAGES.invalidCredentials });
}

export function emailAlreadyRegisteredError(): AppError {
  return new AppError({ code: 'CONFLICT', message: AUTH_MESSAGES.emailAlreadyRegistered });
}

export function invalidResetTokenError(): AppError {
  return new AppError({ code: 'BAD_REQUEST', message: AUTH_MESSAGES.invalidResetToken });
}

export function authenticationRequiredError(): AppError {
  return new AppError({ code: 'UNAUTHORIZED', message: AUTH_MESSAGES.authenticationRequired });
}

export function insufficientRoleError(message?: string): AppError {
  return new AppError({ code: 'FORBIDDEN', message: message ?? AUTH_MESSAGES.insufficientRole });
}

/**
 * Not-found error used when a caller is not allowed to see that a resource
 * exists (for example a session belonging to another user). Returning 404
 * instead of 403 prevents resource enumeration.
 */
export function hiddenResourceError(): AppError {
  return new AppError({ code: 'NOT_FOUND', message: AUTH_MESSAGES.resourceNotFound });
}

export function tooManyAttemptsError(retryAfterSeconds: number): AppError {
  return new AppError({
    code: 'RATE_LIMITED',
    message: AUTH_MESSAGES.tooManyAttempts,
    retryable: true,
    httpStatus: 429,
    // The API layer copies this into the Retry-After header; the value is not a
    // secret and is part of the documented rate-limiting contract.
    cause: { retryAfterSeconds },
  });
}
