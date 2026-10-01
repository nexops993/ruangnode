import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * Aggregates the projects that currently own tests:
 *   - packages/shared   -> unit tests for platform primitives
 *   - packages/database -> schema invariants and configuration helpers
 *   - packages/services -> commerce domain rules (pricing, state machine, input)
 *   - apps/api          -> control plane API tests (in-process, via `inject`)
 *   - tests             -> cross-package integration tests
 *
 * Projects without tests yet are intentionally not listed; they are added
 * when their behaviour exists.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/shared/vitest.config.ts',
      'packages/database/vitest.config.ts',
      'packages/services/vitest.config.ts',
      'apps/api/vitest.config.ts',
      'tests/vitest.config.ts',
    ],
  },
});
