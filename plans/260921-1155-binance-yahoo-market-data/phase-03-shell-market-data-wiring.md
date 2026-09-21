---
phase: 3
title: "Shell Market Data Wiring & Dev Proxy"
status: completed
priority: P2
effort: "2h"
dependencies: [1, 2]
---

# Phase 3: Shell Market Data Wiring & Dev Proxy

## Goal
Configure Vite development proxy to eliminate Yahoo Finance browser CORS blocks and wire real-time & historical market data loading into `AppController` in `packages/shell`.

## Files to Create / Modify
- Modify: `packages/shell/vite.config.ts`
- Modify: `packages/shell/src/controller/AppController.ts`

## Tasks & Steps
1. **Configure Vite Proxy in `vite.config.ts`**:
   - Add proxy route `/api/yahoo`:
     ```ts
     proxy: {
       '/api/yahoo': {
         target: 'https://query1.finance.yahoo.com',
         changeOrigin: true,
         rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
         headers: {
           'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
         },
       },
     }
     ```
2. **Expose Market Data Loader in `AppController`**:
   - Add method `loadSymbolData(providerType: 'binance' | 'yahoo', symbol: string, timeframe?: string)` to `AppController`.
   - Configure Yahoo provider to use `/api/yahoo/v8/finance/chart` when running inside browser environment.
   - Convert fetched `Kline[]` into `ColumnarBarTable` using `@pineorca/data`.
   - Update `cachedBars` and reset chart viewport on the WebGL2 chart adapter (`this.chartAdapter.setBars(this.cachedBars)`).
3. **Connect Live Streaming in `AppController`**:
   - When Binance is selected, call `BinanceProvider.subscribeLiveTicks(symbol, (tick) => this.pushTick(tick))`.
   - Feed incoming ticks to `this.workerBridge.pushTick(tick)` and update the chart's current forming bar in real time.
   - Clean up previous WebSocket subscription whenever the symbol or provider changes.

## Verification
- Run `npm run dev` in `packages/shell` and verify that navigating to `http://localhost:5173` can load both Binance and Yahoo Finance data without browser console CORS errors.
