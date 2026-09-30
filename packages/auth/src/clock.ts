/**
 * Time source.
 *
 * Every session, token and rate-limit decision is expressed against a `Clock`
 * instead of `new Date()`, so expiry and throttling are deterministic in tests
 * and there is no hidden global state (`.clinerules` → TypeScript: avoid global
 * mutable state and hidden side effects).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Milliseconds in one minute / hour / day, for readable configuration. */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
