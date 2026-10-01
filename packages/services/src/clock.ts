/**
 * Time source.
 *
 * Every timestamp a service writes (order creation, payment deadline, snapshot
 * capture) is read from this port instead of `new Date()`, so tests are
 * deterministic and there is no hidden global state (see `.clinerules` →
 * TypeScript: avoid hidden side effects). Mirrors `@ruangnode/auth`'s clock so a
 * process wires one clock for every domain.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
