import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
    },
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
