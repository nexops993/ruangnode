/**
 * Deterministic clock for tests.
 *
 * Session expiry, reset-token expiry and rate-limit windows are all expressed
 * against a `Clock`, so tests advance time explicitly instead of sleeping.
 */
import type { Clock } from '../clock.js';

export interface TestClock extends Clock {
  /** Moves the clock forward. */
  advance(milliseconds: number): void;
  /** Jumps to an absolute instant. */
  set(date: Date): void;
}

export function createTestClock(start: Date | string = '2026-01-01T00:00:00.000Z'): TestClock {
  let current = typeof start === 'string' ? new Date(start) : new Date(start.getTime());

  return {
    now: () => new Date(current.getTime()),
    advance: (milliseconds: number) => {
      current = new Date(current.getTime() + milliseconds);
    },
    set: (date: Date) => {
      current = new Date(date.getTime());
    },
  };
}
