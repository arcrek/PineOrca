import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.benchmark.ts', 'tests/**/*.test.ts'],
    testTimeout: 10000,
  },
});
