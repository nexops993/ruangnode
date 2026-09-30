import { describe, expect, it } from 'vitest';

import { authConfigFromEnv, SECURE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from './config.js';

const SECRET = 'a-sufficiently-long-session-secret-value';

describe('authConfigFromEnv', () => {
  it('requires SESSION_SECRET', () => {
    expect(() => authConfigFromEnv({ NODE_ENV: 'development' })).toThrow(/SESSION_SECRET/);
  });

  it('rejects a secret that is too short', () => {
    expect(() => authConfigFromEnv({ SESSION_SECRET: 'too-short' })).toThrow(/at least 32/);
  });

  it('never echoes the secret value in an error message', () => {
    try {
      authConfigFromEnv({ SESSION_SECRET: 'short-secret-value' });
      throw new Error('expected a configuration error');
    } catch (error) {
      expect((error as Error).message).not.toContain('short-secret-value');
    }
  });

  it('uses a non-secure cookie name outside production', () => {
    const config = authConfigFromEnv({ NODE_ENV: 'development', SESSION_SECRET: SECRET });

    expect(config.cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(config.cookie.secure).toBe(false);
    expect(config.cookie.name.startsWith('__Host-')).toBe(false);
  });

  it('uses a __Host- prefixed, secure cookie in production', () => {
    const config = authConfigFromEnv({ NODE_ENV: 'production', SESSION_SECRET: SECRET });

    expect(config.cookie.name).toBe(SECURE_SESSION_COOKIE_NAME);
    expect(config.cookie.name.startsWith('__Host-')).toBe(true);
    expect(config.cookie.secure).toBe(true);
    expect(config.cookie.path).toBe('/');
    expect(config.cookie.sameSite).toBe('lax');
  });

  it('honours an explicit SESSION_COOKIE_SECURE override', () => {
    const insecure = authConfigFromEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: SECRET,
      SESSION_COOKIE_SECURE: 'false',
    });
    const secureInDevelopment = authConfigFromEnv({
      NODE_ENV: 'development',
      SESSION_SECRET: SECRET,
      SESSION_COOKIE_SECURE: 'true',
    });

    expect(insecure.cookie.secure).toBe(false);
    expect(secureInDevelopment.cookie.secure).toBe(true);
    expect(secureInDevelopment.cookie.name).toBe(SECURE_SESSION_COOKIE_NAME);
  });

  it('rejects an unparsable SESSION_COOKIE_SECURE value', () => {
    expect(() =>
      authConfigFromEnv({ SESSION_SECRET: SECRET, SESSION_COOKIE_SECURE: 'maybe' }),
    ).toThrow(/must be "true" or "false"/);
  });

  it('applies the documented lifetimes by default', () => {
    const config = authConfigFromEnv({ SESSION_SECRET: SECRET });

    expect(config.sessionTtlMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(config.passwordResetTtlMs).toBe(60 * 60 * 1000);
    expect(config.cookie.maxAgeSeconds).toBe(config.sessionTtlMs / 1000);
  });

  it('reads lifetimes from the environment', () => {
    const config = authConfigFromEnv({
      SESSION_SECRET: SECRET,
      SESSION_TTL_HOURS: '12',
      PASSWORD_RESET_TTL_MINUTES: '15',
    });

    expect(config.sessionTtlMs).toBe(12 * 60 * 60 * 1000);
    expect(config.passwordResetTtlMs).toBe(15 * 60 * 1000);
  });

  it('rejects an invalid lifetime instead of silently defaulting', () => {
    expect(() => authConfigFromEnv({ SESSION_SECRET: SECRET, SESSION_TTL_HOURS: '0' })).toThrow(
      /SESSION_TTL_HOURS/,
    );
    expect(() =>
      authConfigFromEnv({ SESSION_SECRET: SECRET, PASSWORD_RESET_TTL_MINUTES: 'soon' }),
    ).toThrow(/PASSWORD_RESET_TTL_MINUTES/);
  });

  it('builds the reset URL from the web application URL', () => {
    const withTrailingSlash = authConfigFromEnv({
      SESSION_SECRET: SECRET,
      WEB_APP_URL: 'https://ruangnode.me/',
    });
    const withoutWebAppUrl = authConfigFromEnv({ SESSION_SECRET: SECRET });

    expect(withTrailingSlash.passwordResetUrl).toBe('https://ruangnode.me/account/reset-password');
    expect(withoutWebAppUrl.passwordResetUrl).toContain('/account/reset-password');
  });

  it('applies the documented rate limits', () => {
    const config = authConfigFromEnv({ SESSION_SECRET: SECRET });

    expect(config.rateLimits.login.limit).toBeGreaterThan(0);
    expect(config.rateLimits.register.limit).toBeGreaterThan(0);
    expect(config.rateLimits.passwordResetRequest.limit).toBeGreaterThan(0);
    expect(config.rateLimits.passwordResetConfirm.limit).toBeGreaterThan(0);
  });
});
