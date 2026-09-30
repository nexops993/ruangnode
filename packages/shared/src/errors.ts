/**
 * Structured error taxonomy.
 *
 * Rules (see .clinerules and docs/SECURITY.md):
 *   - messages attached to an `AppError` are safe to show to users
 *   - internal diagnostics belong in `cause` and are logged server-side only
 *   - unknown/unexpected errors must never leak their message to a client
 */

/** Machine-readable error codes shared by API handlers, services and agents. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

/** Default HTTP status for each error code. */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  /** Machine-readable code. Determines the default HTTP status. */
  code: ErrorCode;
  /** Safe, user-facing message. Must not contain secrets or internal paths. */
  message: string;
  /** Overrides the default status derived from `code`. */
  httpStatus?: number;
  /** Whether the caller may safely retry the failed operation. */
  retryable?: boolean;
  /** Internal cause. Logged server-side, never returned to clients. */
  cause?: unknown;
}

/**
 * Expected, structured application error.
 *
 * `message` is user-safe by construction; internal detail travels in `cause`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? HTTP_STATUS_BY_ERROR_CODE[options.code];
    this.retryable = options.retryable ?? false;
  }

  static badRequest(message = 'The request could not be processed.'): AppError {
    return new AppError({ code: 'BAD_REQUEST', message });
  }

  static unauthorized(message = 'Authentication is required.'): AppError {
    return new AppError({ code: 'UNAUTHORIZED', message });
  }

  static forbidden(message = 'You are not allowed to perform this action.'): AppError {
    return new AppError({ code: 'FORBIDDEN', message });
  }

  static notFound(message = 'The requested resource was not found.'): AppError {
    return new AppError({ code: 'NOT_FOUND', message });
  }

  static conflict(message = 'The request conflicts with the current state.'): AppError {
    return new AppError({ code: 'CONFLICT', message });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Response body shape used for every API error response. */
export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export interface ErrorResponse {
  status: number;
  body: ErrorResponseBody;
}

/**
 * Maps any thrown value to a status code and a safe response body.
 *
 * Unknown errors are reported as a generic 500: their message, stack and cause
 * stay on the server.
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (isAppError(error)) {
    return {
      status: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      },
    };
  }

  return {
    status: HTTP_STATUS_BY_ERROR_CODE.INTERNAL,
    body: {
      error: {
        code: 'INTERNAL',
        message: 'An unexpected error occurred.',
        retryable: false,
      },
    },
  };
}
