import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: '@ruangnode/node-agent', include: ['src/**/*.test.ts'] } });