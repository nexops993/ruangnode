/**
 * Test support for `@ruangnode/auth`.
 *
 * Exported through the `./testing` subpath so the API tests and the cross-package
 * integration tests use one implementation of each double. Nothing here is used
 * by the control plane process.
 */
import { AuthService, type AuthServiceOptions } from '../auth-service.js';
import { createArgon2idPasswordHasher, type Argon2idParams } from '../password.js';
import { createInMemoryAuthStore, type InMemoryAuthStore } from './in-memory-store.js';
import { createTestClock, type TestClock } from './clock.js';
import {
  createCapturingPasswordResetNotifier,
  type CapturingPasswordResetNotifier,
} from './notifier.js';

export * from './app-error.js';
export * from './clock.js';
export * from './in-memory-store.js';
export * from './notifier.js';

/**
 * Argon2id parameters used by tests.
 *
 * Still Argon2id, just with a smaller memory cost so a suite that hashes dozens
 * of passwords stays fast. The production parameters (19 MiB, 2 iterations) are
 * asserted separately in `password.test.ts`.
 */
export const TEST_ARGON2ID_PARAMS: Argon2idParams = {
  memoryCostKib: 4_096,
  timeCost: 1,
  parallelism: 1,
  outputLen: 32,
};

export interface TestAuthFixture {
  store: InMemoryAuthStore;
  clock: TestClock;
  notifier: CapturingPasswordResetNotifier;
  service: AuthService;
}

/**
 * Builds an `AuthService` wired to the in-memory store, a deterministic clock and
 * a capturing notifier.
 */
export function createTestAuthFixture(
  options: Partial<Omit<AuthServiceOptions, 'store'>> & { start?: Date | string } = {},
): TestAuthFixture {
  const store = createInMemoryAuthStore();
  const clock = createTestClock(options.start ?? '2026-01-01T00:00:00.000Z');
  const notifier = createCapturingPasswordResetNotifier();
  const { start: _start, ...serviceOptions } = options;

  const service = new AuthService({
    store,
    clock,
    notifier,
    hasher: createArgon2idPasswordHasher(TEST_ARGON2ID_PARAMS),
    ...serviceOptions,
  });

  return { store, clock, notifier, service };
}
