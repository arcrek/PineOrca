---
phase: 6
title: "Live Streaming Engine, Golden Test Suite & TV Oracle Parity"
status: pending
priority: P1
effort: "5d"
dependencies: ["5"]
---

# Phase 6: Live Streaming Engine, Golden Test Suite & TV Oracle Parity

## Goal
Implement real-time WebSocket tick streaming with provisional bar state rollbacks, and validate the platform against a comprehensive test matrix of reference strategies with strict float tolerance thresholds against TradingView.

## Files to Create / Modify
- Create: `packages/engine-pinets/src/streaming/LiveStreamingLoop.ts` (Provisional bar execution and state rollback engine)
- Create: `packages/engine-pinets/src/streaming/StateSnapshot.ts` (Fast snapshot and restore of strategy state)
- Create: `packages/data/src/feed/WebSocketProvider.ts` (Live WebSocket connection with debounced RAF dispatch)
- Create: `tests/golden/fixtures/rsi-mean-reversion.tv.json` (TradingView golden export reference data)
- Create: `tests/golden/fixtures/bb-pyramiding.tv.json` (TradingView golden export reference data)
- Create: `tests/golden/fixtures/macd-reversal.tv.json` (TradingView golden export reference data)
- Create: `tests/golden/fixtures/turtle-trailing.tv.json` (TradingView golden export reference data)
- Create: `tests/golden/fixtures/crypto-margin-call.tv.json` (TradingView golden export reference data)
- Create: `tests/golden/parity-oracle.test.ts` (Automated end-to-end parity test suite)
- Create: `packages/engine-pinets/test/live-streaming.test.ts` (Tick streaming and rollback stress test)

## Tasks & Steps
1. **Live Streaming Engine & Rollback Mechanics**:
   - Implement `snapshotStrategyState` and `restoreStrategyState` capturing active positions, orders, and equity peaks at the close of confirmed bar $N-1$.
   - When provisional ticks arrive on forming bar $N$, re-execute bar logic tentatively without mutating historical state.
   - On confirmed bar close ($N$), commit final orders, latch equity peaks, and advance the historical window.
   - Implement debounced batching (60Hz RequestAnimationFrame) to prevent high-frequency WebSocket tick floods from freezing the chart.
2. **Golden Reference Test Matrix Assembly**:
   - Curate 5 canonical benchmark strategies with ground truth exported from TradingView:
     1. *RSI Mean Reversion*: Single-entry baseline, market orders at next bar open.
     2. *Bollinger Bands Breakout*: Pyramiding up to 3 lots, FIFO trade closing.
     3. *MACD Dual Reversal*: Directional position flips with simultaneous entry/exit legs.
     4. *Turtle Trend System*: Trailing stops, tick-based exit brackets, and peak tracking.
     5. *Leveraged Crypto Perpetual*: High-leverage BTCUSDT margin liquidation under high volatility.
3. **Parity Tolerance Enforcement (`parity-oracle.test.ts`)**:
   - Compare PineOrca execution outputs against TradingView oracle exports:
     - Closed Trade Count: 0 mismatch (100% exact match).
     - Win / Loss Counts: 0 mismatch.
     - Net Profit: Divergence $\le 0.001\%$.
     - Gross Profit & Gross Loss: Divergence $\le 0.001\%$.
     - Max Drawdown (% and $): Divergence $\le 0.01\%$.
     - Profit Factor: Divergence $\le 0.005$.
     - Individual Trade Fill Prices: Divergence $\le 0.0001\%$.

## Verification
- `npx vitest run packages/engine-pinets/test/live-streaming.test.ts`
  - *Pass criteria*: Stress test under 1,000 provisional ticks/sec demonstrates zero memory leak and zero state drift between tick and bar-close.
- `npx vitest run tests/golden/parity-oracle.test.ts --reporter=verbose`
  - *Pass criteria*: All 5 canonical strategy benchmarks pass with zero trade count divergence and $<0.01\%$ metric error against TradingView.
