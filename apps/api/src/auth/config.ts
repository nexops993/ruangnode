/**
 * Authentication configuration for the control plane API.
 *
 * Configuration is read and validated at the boundary: the process entrypoint
 * calls `authConfigFromEnv()` once and fails fast when a required value is
 * missing or malformed, instead of discovering it on the first login attempt.
 *
 * No secret is ever included in an error message or a log line.
 */
import {
  AUTH_RATE_LIMITS,
  DEFAULT_PASSWORD_RESET_TTL_MS,
  DEFAULT_SESSION_TTL_MS,
  HOUR_MS,
  MINUTE_MS,
  type RateLimitRule,
} from '@ruangnode/auth';

/**
 * Cookie names.
 *
 * The `__Host-` prefix is used whenever the cookie is `Secure`: browsers reject
 * such a cookie unless it is also `Path=/`, has no `Domain` and is set over
 * HTTPS, which prevents a subdomain from overwriting the session cookie.
 */
export const SESSION_COOKIE_NAME = 'ruangnode_session';
export const SECURE_SESSION_COOKIE_NAME = '__Host-ruangnode_session';

/** Minimum length accepted for `SESSION_SECRET` (it signs the cookie). */
const MIN_SESSION_SECRET_LENGTH = 32;

export interface SessionCookieConfig {
  name: string;
  /** HMAC secret used to sign and verify the cookie value. */
  secret: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  /** Cookie lifetime in seconds; matches the session lifetime. */
  maxAgeSeconds: number;
}

export interface AuthRateLimitConfig {
  register: RateLimitRule;
  login: RateLimitRule;
  passwordResetRequest: RateLimitRule;
  passwordResetConfirm: RateLimitRule;
}

export interface AuthConfig {
  cookie: SessionCookieConfig;
  sessionTtlMs: number;
  passwordResetTtlMs: number;
  /** Base URL of the web page that completes a reset (token is appended). */
  passwordResetUrl: string;
  rateLimits: AuthRateLimitConfig;
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  max: number,
): number {
  const raw = env[key];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${key} must be an integer between 1 and ${max}.`);
  }

  return value;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();

  if (raw === undefined || raw === '') {
    return fallback;
  }

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  throw new Error(`${key} must be "true" or "false".`);
}

/**
 * Builds the authentication configuration.
 *
 * `SESSION_SECRET` is required: it signs the session cookie, so a missing value
 * is a configuration error rather than something to paper over with a default.
 */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.SESSION_SECRET?.trim() ?? '';

  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set to at least ${MIN_SESSION_SECRET_LENGTH} characters. ` +
        'Generate one with: openssl rand -base64 48',
    );
  }

  const isProduction = env.NODE_ENV === 'production';
  // Secure cookies are the default outside local development; the override
  // exists for HTTPS development setups only.
  const secure = readBoolean(env, 'SESSION_COOKIE_SECURE', isProduction);

  const sessionTtlHours = readPositiveInteger(env, 'SESSION_TTL_HOURS', 720, 24 * 365);
  const passwordResetTtlMinutes = readPositiveInteger(env, 'PASSWORD_RESET_TTL_MINUTES', 60, 1440);
  const sessionTtlMs =
    env.SESSION_TTL_HOURS === undefined ? DEFAULT_SESSION_TTL_MS : sessionTtlHours * HOUR_MS;
  const passwordResetTtlMs =
    env.PASSWORD_RESET_TTL_MINUTES === undefined
      ? DEFAULT_PASSWORD_RESET_TTL_MS
      : passwordResetTtlMinutes * MINUTE_MS;

  const webAppUrl = (env.WEB_APP_URL?.trim() ?? '').replace(/\/+$/, '');
  const passwordResetUrl =
    webAppUrl === ''
      ? 'https://ruangnode.me/account/reset-password'
      : `${webAppUrl}/account/reset-password`;

  return {
    cookie: {
      name: secure ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME,
      secret,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
    },
    sessionTtlMs,
    passwordResetTtlMs,
    passwordResetUrl,
    rateLimits: AUTH_RATE_LIMITS,
  };
}
