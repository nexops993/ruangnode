import { defineConfig } from 'vitest/config';

/**
 * Integration tests. These exercise more than one workspace package at a time
 * (for example the API package together with the shared primitives), which is
 * why they live outside the packages they verify.
 */
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['integration/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
