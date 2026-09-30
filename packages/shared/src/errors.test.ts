import { describe, expect, it } from 'vitest';

import {
  AppError,
  HTTP_STATUS_BY_ERROR_CODE,
  isAppError,
  toErrorResponse,
  type ErrorCode,
} from './errors.js';

describe('AppError', () => {
  it('derives the HTTP status from the error code', () => {
    expect(AppError.notFound().httpStatus).toBe(404);
    expect(AppError.unauthorized().httpStatus).toBe(401);
    expect(AppError.forbidden().httpStatus).toBe(403);
    expect(AppError.conflict().httpStatus).toBe(409);
    expect(AppError.badRequest().httpStatus).toBe(400);
  });

  it('maps every error code to a status', () => {
    const codes: ErrorCode[] = [
      'BAD_REQUEST',
      'VALIDATION_FAILED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
      'INTERNAL',
    ];

    for (const code of codes) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it('allows overriding the status and marking an error retryable', () => {
    const error = new AppError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The node is temporarily unavailable.',
      httpStatus: 502,
      retryable: true,
    });

    expect(error.httpStatus).toBe(502);
    expect(error.retryable).toBe(true);
  });

  it('keeps internal detail in `cause` instead of the message', () => {
    const cause = new Error('connection string postgresql://user:secret@db');
    const error = new AppError({
      code: 'INTERNAL',
      message: 'The service is unavailable.',
      cause,
    });

    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('secret');
  });

  it('is recognised by isAppError and by instanceof Error', () => {
    const error = AppError.forbidden();

    expect(isAppError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('nope')).toBe(false);
  });
});

describe('toErrorResponse', () => {
  it('exposes the code, safe message and retryability of an AppError', () => {
    const response = toErrorResponse(
      new AppError({ code: 'RATE_LIMITED', message: 'Too many attempts.', retryable: true }),
    );

    expect(response).toEqual({
      status: 429,
      body: {
        error: { code: 'RATE_LIMITED', message: 'Too many attempts.', retryable: true },
      },
    });
  });

  it('never leaks the message of an unknown error', () => {
    const response = toErrorResponse(new Error('ECONNREFUSED 10.0.0.5:5432'));

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(response)).not.toContain('10.0.0.5');
    expect(response.body.error.message).not.toContain('ECONNREFUSED');
  });
});
