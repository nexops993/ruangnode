/**
 * Test helper: capture a structured failure without asserting inside a promise
 * chain, so a test can inspect several properties of the error.
 *
 * Deliberately free of any test-framework import so `@ruangnode/auth/testing`
 * stays usable from any test runner.
 */
import { AppError } from '@ruangnode/shared';

/**
 * Awaits `operation` and returns the `AppError` it threw.
 *
 * Throws when the operation succeeds or fails with something other than an
 * `AppError`, so a test can never pass because of an unrelated crash.
 */
export async function captureAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected the operation to fail with an AppError, but it resolved.');
}
