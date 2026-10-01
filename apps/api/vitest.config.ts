import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
