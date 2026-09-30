/**
 * Request schemas for the authentication endpoints.
 *
 * Validation happens at the boundary (Fastify's AJV-based schema validation)
 * before a handler or a service runs, and the same rules are enforced again in
 * the domain service so the services stay safe when they are called from
 * somewhere other than HTTP.
 *
 * `additionalProperties: false` is used together with Fastify's default AJV
 * options, which *remove* unknown properties. A client that smuggles an extra
 * field (for example `role`) therefore cannot reach a handler with it, and the
 * domain never sees it either.
 *
 * Response schemas are also declared: Fastify serialises through the schema, so a
 * field that is not listed (for example a password hash accidentally added to a
 * projection) can never reach a client.
 */
import type { FastifySchema } from 'fastify';

/** Matches the Argon2 input bound in `@ruangnode/auth` (password policy). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 120;

const emailProperty = {
  type: 'string',
  format: 'email',
  maxLength: EMAIL_MAX_LENGTH,
} as const;

const passwordProperty = {
  type: 'string',
  minLength: PASSWORD_MIN_LENGTH,
  maxLength: PASSWORD_MAX_LENGTH,
} as const;

/** Login does not restate the password policy: it only bounds the input. */
const loginPasswordProperty = {
  type: 'string',
  minLength: 1,
  maxLength: PASSWORD_MAX_LENGTH,
} as const;

const publicUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'name', 'role', 'status'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    name: { type: ['string', 'null'] },
    role: { type: 'string' },
    status: { type: 'string' },
  },
} as const;

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
} as const;

/** `{ data: { user } }`. The session cookie is not part of the body. */
const authenticatedResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['user'],
      properties: { user: publicUserSchema },
    },
  },
} as const;

const messageResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: { message: { type: 'string' } },
    },
  },
} as const;

export const registerRouteSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: emailProperty,
      password: passwordProperty,
      name: { type: 'string', minLength: 1, maxLength: NAME_MAX_LENGTH },
    },
  },
  response: {
    201: authenticatedResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema,
    429: errorResponseSchema,
  },
} satisfies FastifySchema;

export const loginRouteSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: emailProperty,
      password: loginPasswordProperty,
    },
  },
  response: {
    200: authenticatedResponseSchema,
    401: errorResponseSchema,
    422: errorResponseSchema,
    429: errorResponseSchema,
  },
} satisfies FastifySchema;

export const currentUserRouteSchema = {
  response: {
    200: authenticatedResponseSchema,
    401: errorResponseSchema,
  },
} satisfies FastifySchema;

export const logoutRouteSchema = {
  response: {
    204: { type: 'null' },
    401: errorResponseSchema,
  },
} satisfies FastifySchema;

export const listSessionsRouteSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['sessions'],
          properties: {
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'createdAt',
                  'lastUsedAt',
                  'expiresAt',
                  'ipAddress',
                  'userAgent',
                  'current',
                ],
                properties: {
                  id: { type: 'string' },
                  createdAt: { type: 'string' },
                  lastUsedAt: { type: 'string' },
                  expiresAt: { type: 'string' },
                  ipAddress: { type: ['string', 'null'] },
                  userAgent: { type: ['string', 'null'] },
                  current: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    401: errorResponseSchema,
  },
} satisfies FastifySchema;

export const revokeSessionRouteSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    204: { type: 'null' },
    401: errorResponseSchema,
    404: errorResponseSchema,
  },
} satisfies FastifySchema;

export const revokeOtherSessionsRouteSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['revokedCount'],
          properties: { revokedCount: { type: 'integer' } },
        },
      },
    },
    401: errorResponseSchema,
  },
} satisfies FastifySchema;

export const passwordResetRequestRouteSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: { email: emailProperty },
  },
  response: {
    202: messageResponseSchema,
    422: errorResponseSchema,
    429: errorResponseSchema,
  },
} satisfies FastifySchema;

export const passwordResetConfirmRouteSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'password'],
    properties: {
      token: { type: 'string', minLength: 20, maxLength: 200 },
      password: passwordProperty,
    },
  },
  response: {
    200: messageResponseSchema,
    400: errorResponseSchema,
    422: errorResponseSchema,
    429: errorResponseSchema,
  },
} satisfies FastifySchema;
