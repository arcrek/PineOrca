import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@pineorca/data': path.resolve(__dirname, '../data/src'),
      '@pineorca/worker-bridge': path.resolve(__dirname, '../worker-bridge/src'),
      '@pineorca/engine-pinets/worker': path.resolve(__dirname, '../engine-pinets/src/worker/worker.ts'),
      '@pineorca/engine-pinets': path.resolve(__dirname, '../engine-pinets/src'),
      '@pineorca/chart': path.resolve(__dirname, '../chart/src'),
      '@pineorca/ui': path.resolve(__dirname, '../ui/src'),
    },
  },
});
