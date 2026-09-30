import { describe, expect, it } from 'vitest';

import { AUTH_RATE_LIMITS, createInMemoryRateLimiter, type RateLimitRule } from './rate-limit.js';

const RULE: RateLimitRule = { limit: 3, windowMs: 60_000 };
const START = new Date('2026-01-01T00:00:00.000Z');

describe('in-memory rate limiter', () => {
  it('allows attempts up to the limit and reports the remaining budget', () => {
    const limiter = createInMemoryRateLimiter();

    expect(limiter.consume('key', RULE, START)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.consume('key', RULE, START)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume('key', RULE, START)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('blocks once the limit is reached and reports when to retry', () => {
    const limiter = createInMemoryRateLimiter();

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      limiter.consume('key', RULE, START);
    }

    const blocked = limiter.consume('key', RULE, START);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('slides the window instead of resetting on a fixed boundary', () => {
    const limiter = createInMemoryRateLimiter();
    const later = new Date(START.getTime() + 59_000);

    limiter.consume('key', RULE, START);
    limiter.consume('key', RULE, later);
    limiter.consume('key', RULE, later);
    expect(limiter.consume('key', RULE, later).allowed).toBe(false);

    const afterWindow = new Date(START.getTime() + 60_001);
    expect(limiter.consume('key', RULE, afterWindow).allowed).toBe(true);
  });

  it('keeps separate buckets per key', () => {
    const limiter = createInMemoryRateLimiter();

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      limiter.consume('client-a', RULE, START);
    }

    expect(limiter.consume('client-a', RULE, START).allowed).toBe(false);
    expect(limiter.consume('client-b', RULE, START).allowed).toBe(true);
  });

  it('bounds the number of tracked keys', () => {
    const limiter = createInMemoryRateLimiter({ maxKeys: 2 });

    limiter.consume('key-a', { limit: 1, windowMs: 60_000 }, START);
    expect(limiter.consume('key-a', { limit: 1, windowMs: 60_000 }, START).allowed).toBe(false);

    limiter.consume('key-b', RULE, START);
    limiter.consume('key-c', RULE, START);

    // key-a was evicted, so its budget is available again.
    expect(limiter.consume('key-a', { limit: 1, windowMs: 60_000 }, START).allowed).toBe(true);
  });

  it('can be reset', () => {
    const limiter = createInMemoryRateLimiter();

    limiter.consume('key', { limit: 1, windowMs: 60_000 }, START);
    limiter.reset();

    expect(limiter.consume('key', { limit: 1, windowMs: 60_000 }, START).allowed).toBe(true);
  });
});

describe('default authentication rate limits', () => {
  it('defines a rule for every authentication endpoint family', () => {
    expect(Object.keys(AUTH_RATE_LIMITS).sort()).toEqual([
      'login',
      'passwordResetConfirm',
      'passwordResetRequest',
      'register',
    ]);

    for (const rule of Object.values(AUTH_RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowMs).toBeGreaterThanOrEqual(60_000);
    }
  });
});
