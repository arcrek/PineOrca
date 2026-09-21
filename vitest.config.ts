import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.benchmark.ts', 'tests/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@pineorca/data': path.resolve(__dirname, 'packages/data/src'),
      '@pineorca/worker-bridge': path.resolve(__dirname, 'packages/worker-bridge/src'),
      '@pineorca/engine-pinets/worker': path.resolve(__dirname, 'packages/engine-pinets/src/worker/worker.ts'),
      '@pineorca/engine-pinets': path.resolve(__dirname, 'packages/engine-pinets/src'),
      '@pineorca/chart': path.resolve(__dirname, 'packages/chart/src'),
      '@pineorca/ui': path.resolve(__dirname, 'packages/ui/src'),
      '@pineorca/shell': path.resolve(__dirname, 'packages/shell/src'),
    },
  },
});
