/**
 * Maps Fastify's schema-validation failures onto the shared error envelope.
 *
 * Fastify's default validation error body has its own shape, which would bypass
 * `@ruangnode/shared`'s `{ error: { code, message, retryable } }` contract. This
 * module converts it into a `VALIDATION_FAILED` (422) `AppError`.
 *
 * Only field *names* are echoed; submitted values (which may contain a password)
 * are never included, and the underlying AJV detail stays in the server log.
 */
import { AppError } from '@ruangnode/shared';
import type { FastifyError } from 'fastify';

interface ValidationIssue {
  instancePath?: string;
  params?: { missingProperty?: string; additionalProperty?: string };
}

function fieldName(issue: ValidationIssue): string | null {
  const path = issue.instancePath?.replace(/^\//, '').replace(/\//g, '.');

  if (path !== undefined && path !== '') {
    return path;
  }

  return issue.params?.missingProperty ?? issue.params?.additionalProperty ?? null;
}

/**
 * Builds the safe, user-facing message for a validation failure.
 *
 * Example: `The request is invalid: body.password.`
 */
export function describeValidationFailure(error: FastifyError): string {
  const issues = Array.isArray(error.validation) ? (error.validation as ValidationIssue[]) : [];
  const fields = [
    ...new Set(issues.map(fieldName).filter((name): name is string => name !== null)),
  ];

  if (fields.length === 0) {
    return 'The request payload is invalid.';
  }

  return `The request is invalid: ${fields.join(', ')}.`;
}

/** True when the error is a Fastify schema-validation failure. */
export function isValidationError(error: unknown): error is FastifyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    (error as { validation?: unknown }).validation !== undefined
  );
}

export function validationError(error: FastifyError): AppError {
  return new AppError({
    code: 'VALIDATION_FAILED',
    message: describeValidationFailure(error),
    cause: error.validation,
  });
}
