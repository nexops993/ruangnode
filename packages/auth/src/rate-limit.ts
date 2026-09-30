/**
 * Rate limiting for authentication endpoints.
 *
 * Login, registration and password reset are the classic credential-stuffing and
 * enumeration targets, so they are limited per client (and per hashed account
 * identifier) before any password work happens.
 *
 * This implementation is in-process and therefore per-instance: it protects a
 * single API process and is reset on restart. `docs/DECISIONS.md` records that a
 * shared store (Redis) is deferred until it is genuinely required, and that the
 * limitation must be revisited before the API is scaled horizontally.
 *
 * The clock is injected so window behaviour is deterministic in tests.
 */
export interface RateLimitRule {
  /** Maximum number of attempts allowed inside `windowMs`. */
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest attempt leaves the window. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, rule: RateLimitRule, now: Date): RateLimitDecision;
  /** Test/operational helper: drops all recorded attempts. */
  reset(): void;
}

export interface InMemoryRateLimiterOptions {
  /**
   * Upper bound on tracked keys. Bounded memory matters because the key space is
   * attacker-controlled (arbitrary client addresses).
   */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createInMemoryRateLimiter(options: InMemoryRateLimiterOptions = {}): RateLimiter {
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const attempts = new Map<string, number[]>();

  function evictIfNeeded(): void {
    if (attempts.size <= maxKeys) {
      return;
    }

    // Evict the oldest inserted key (Map preserves insertion order).
    const oldest = attempts.keys().next();

    if (!oldest.done) {
      attempts.delete(oldest.value);
    }
  }

  return {
    consume(key: string, rule: RateLimitRule, now: Date): RateLimitDecision {
      const windowStart = now.getTime() - rule.windowMs;
      const recent = (attempts.get(key) ?? []).filter((at) => at > windowStart);

      if (recent.length >= rule.limit) {
        const oldestInWindow = recent[0] ?? now.getTime();
        const retryAfterMs = oldestInWindow + rule.windowMs - now.getTime();

        attempts.set(key, recent);

        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      recent.push(now.getTime());
      attempts.set(key, recent);
      evictIfNeeded();

      return {
        allowed: true,
        remaining: Math.max(0, rule.limit - recent.length),
        retryAfterSeconds: 0,
      };
    },

    reset(): void {
      attempts.clear();
    },
  };
}

/**
 * Default rules per endpoint family.
 *
 * `register` and `passwordReset` are limited per client address; `login` and
 * `passwordResetConfirm` are additionally keyed by the hashed account
 * identifier, so a single attacker address cannot be used to probe many accounts
 * and a distributed attack against one account is still throttled.
 */
export const AUTH_RATE_LIMITS = {
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  passwordResetRequest: { limit: 5, windowMs: 60 * 60 * 1000 },
  passwordResetConfirm: { limit: 10, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;
