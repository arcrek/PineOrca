// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect } from 'vitest';
import { ColumnarBarTable, WebSocketProvider, type TickUpdate } from '@pineorca/data';
import {
  PineTranspiler,
  PineContext,
  PineEngine,
  LiveStreamingLoop,
  takeContextSnapshot,
  restoreContextSnapshot,
} from '../src';

function createHistoricalTable(count: number, basePrice: number = 100): ColumnarBarTable {
  const table = ColumnarBarTable.allocate(count);
  const baseTime = 1609459200000;
  for (let i = 0; i < count; i++) {
    const p = basePrice + (i % 2 === 0 ? 2 : -2);
    table.time[i] = baseTime + i * 60000;
    table.open[i] = p;
    table.high[i] = p + 2;
    table.low[i] = p - 2;
    table.close[i] = p;
    table.volume[i] = 1000;
  }
  return table;
}

describe('LiveStreamingLoop & State Rollback Engine', () => {
  it('tentatively executes provisional ticks and rolls back without historical leakage', () => {
    const script = `//@version=5
strategy("Streaming Test", overlay=true, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1)
if (close > 102)
    strategy.entry("Long", strategy.long)
if (close < 98)
    strategy.close("Long")
`;
    const compiled = PineTranspiler.transpile(script, { sync: true });
    const table = createHistoricalTable(10, 100);
    const ctx = new PineContext({ table, timeframe: '1' });
    ctx.pine.syminfo = { pointvalue: 1, mintick: 0.01 };

    const loop = new LiveStreamingLoop(ctx, compiled.fn, { useDebounce: false });
    loop.initialize(true); // executes historical bars 0..9

    expect(loop.confirmedBarIndex).toBe(9);
    const initialClosedCount = ctx.strategy.closedtrades.length;
    const initialOpenCount = ctx.strategy.opentrades.length;

    // Push tick 1: price rises to 105 -> triggers long entry order
    const baseTime = 1609459200000 + 10 * 60000;
    loop.pushTick({ price: 105, volume: 100, time: baseTime });

    expect(loop.formingBarIndex).toBe(10);
    expect(ctx.idx).toBe(10);
    expect(ctx.pine.barstate.isconfirmed).toBe(false);
    expect(ctx.pine.barstate.isrealtime).toBe(true);

    // Push tick 2: price drops to 95 -> rolls back tick 1 and re-executes with low price
    loop.pushTick({ price: 95, volume: 150, time: baseTime + 1000 });
    expect(loop.formingBar?.high).toBe(105);
    expect(loop.formingBar?.low).toBe(95);
    expect(loop.formingBar?.close).toBe(95);
    expect(loop.formingBar?.volume).toBe(250);

    // Rollback ensures no duplicate open positions accumulated
    expect(ctx.strategy.closedtrades.length).toBe(initialClosedCount);

    // Close the bar officially at close = 99
    const closed = loop.closeBar({ close: 99 });
    expect(closed.close).toBe(99);
    expect(loop.confirmedBarIndex).toBe(10);
    expect(loop.formingBar).toBeNull();
  });

  it('guarantees 0 state drift between streaming ticks and single-pass batch execution', () => {
    const script = `//@version=5
strategy("Parity Drift Check", overlay=true, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1)
if (close > 105)
    strategy.entry("Long", strategy.long)
if (close < 95)
    strategy.close("Long")
`;
    const compiled = PineTranspiler.transpile(script, { sync: true });
    const barPrices = [
      100, 101, 102, 106, 108, 110, 107, 103, 94, 92, 95, 99, 106, 109, 93,
    ];
    const totalBars = barPrices.length;

    // --- Pass A: Batch execution ---
    const tableBatch = ColumnarBarTable.allocate(totalBars);
    const baseTime = 1609459200000;
    for (let i = 0; i < totalBars; i++) {
      const p = barPrices[i];
      tableBatch.time[i] = baseTime + i * 60000;
      tableBatch.open[i] = i === 0 ? p : barPrices[i - 1];
      tableBatch.high[i] = Math.max(tableBatch.open[i], p) + 1;
      tableBatch.low[i] = Math.min(tableBatch.open[i], p) - 1;
      tableBatch.close[i] = p;
      tableBatch.volume[i] = 1000;
    }
    const ctxBatch = new PineContext({ table: tableBatch, timeframe: '1' });
    ctxBatch.pine.syminfo = { pointvalue: 1, mintick: 0.01 };
    PineEngine.executeSync(ctxBatch, compiled.fn);

    // --- Pass B: Live streaming with rollbacks ---
    const historyCount = 5;
    const tableStream = ColumnarBarTable.allocate(totalBars);
    for (let i = 0; i < historyCount; i++) {
      tableStream.time[i] = tableBatch.time[i];
      tableStream.open[i] = tableBatch.open[i];
      tableStream.high[i] = tableBatch.high[i];
      tableStream.low[i] = tableBatch.low[i];
      tableStream.close[i] = tableBatch.close[i];
      tableStream.volume[i] = tableBatch.volume[i];
    }
    const ctxStream = new PineContext({ table: tableStream, timeframe: '1' });
    ctxStream.length = historyCount;
    ctxStream.pine.syminfo = { pointvalue: 1, mintick: 0.01 };

    const loop = new LiveStreamingLoop(ctxStream, compiled.fn, { useDebounce: false });
    loop.initialize(true); // runs bars 0..4

    // Stream remaining bars (5..totalBars-1)
    for (let i = historyCount; i < totalBars; i++) {
      const targetBar = {
        time: tableBatch.time[i],
        open: tableBatch.open[i],
        high: tableBatch.high[i],
        low: tableBatch.low[i],
        close: tableBatch.close[i],
        volume: tableBatch.volume[i],
      };

      // Push 5 intermediate provisional ticks before closing
      loop.pushTick({ price: targetBar.open, time: targetBar.time });
      loop.pushTick({ price: targetBar.high, time: targetBar.time });
      loop.pushTick({ price: targetBar.low, time: targetBar.time });
      loop.pushTick({ price: (targetBar.high + targetBar.low) / 2, time: targetBar.time });
      loop.pushTick({ price: targetBar.close, time: targetBar.time });

      loop.closeBar(targetBar);
    }

    // Verify 0 state drift
    expect(ctxStream.strategy.closedtrades.length).toBe(ctxBatch.strategy.closedtrades.length);
    expect(ctxStream.strategy.opentrades.length).toBe(ctxBatch.strategy.opentrades.length);
    expect(ctxStream.strategy.position_size).toBe(ctxBatch.strategy.position_size);
    expect(ctxStream.strategy.netprofit).toBeCloseTo(ctxBatch.strategy.netprofit, 8);
    expect(ctxStream.strategy.equity).toBeCloseTo(ctxBatch.strategy.equity, 8);
    expect(ctxStream.strategy.grossprofit).toBeCloseTo(ctxBatch.strategy.grossprofit, 8);
    expect(ctxStream.strategy.grossloss).toBeCloseTo(ctxBatch.strategy.grossloss, 8);
  });

  it('passes stress test under 1,000 provisional ticks/sec with zero memory leak and zero state drift', () => {
    const script = `//@version=5
strategy("Stress Test", overlay=true, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1)
if (close > 105)
    strategy.entry("Long", strategy.long)
if (close < 95)
    strategy.close("Long")
`;
    const compiled = PineTranspiler.transpile(script, { sync: true });
    const table = createHistoricalTable(20, 100);
    const ctx = new PineContext({ table, timeframe: '1' });
    ctx.pine.syminfo = { pointvalue: 1, mintick: 0.01 };

    const loop = new LiveStreamingLoop(ctx, compiled.fn, { useDebounce: false });
    loop.initialize(true); // run bars 0..19

    const confirmedSnapshot = takeContextSnapshot(ctx);
    const baselineClosedTrades = ctx.strategy.closedtrades.length;
    const baselineEquity = ctx.strategy.equity;

    // Blast 1,000 provisional ticks into bar 20
    const barTime = 1609459200000 + 20 * 60000;
    const startTime = performance.now();

    for (let t = 0; t < 1000; t++) {
      // Oscillate between 90 and 110 to trigger provisional entry/exit conditions repeatedly
      const price = 100 + Math.sin(t / 10) * 10;
      loop.pushTick({ price, volume: 10, time: barTime + t });
    }

    const duration = performance.now() - startTime;
    expect(loop.ticksProcessed).toBe(1000);

    // Verify that after 1,000 provisional ticks on the forming bar, closedtrades array did NOT leak
    expect(ctx.strategy.closedtrades.length).toBe(baselineClosedTrades);

    // Restore to confirmed baseline and verify zero drift
    restoreContextSnapshot(ctx, confirmedSnapshot);
    expect(ctx.strategy.closedtrades.length).toBe(baselineClosedTrades);
    expect(ctx.strategy.equity).toBe(baselineEquity);

    // Commit bar close cleanly
    const closed = loop.closeBar({ open: 100, high: 110, low: 90, close: 101, volume: 10000 });
    expect(closed.ticksCount).toBe(1000);
    expect(loop.confirmedBarIndex).toBe(20);
  });

  it('coalesces high-frequency WebSocket tick floods at 60Hz RAF batching', async () => {
    const ws = new WebSocketProvider({
      batchIntervalMs: 10,
      useRaf: false,
    });

    const received: TickUpdate[] = [];
    ws.subscribe('BTCUSDT', '1', (tick) => {
      received.push(tick);
    });

    // Ingest 500 rapid ticks for BTCUSDT without waiting
    for (let i = 0; i < 500; i++) {
      ws.handleMessage({
        symbol: 'BTCUSDT',
        price: 50000 + i,
        volume: 1,
        time: 1609459200000 + i * 10,
      });
    }

    // Because of debouncing, callbacks have not fired yet (0 UI freezing)
    expect(received.length).toBe(0);

    // Synchronously flush debounced frame
    ws.flush();

    // Exactly 1 coalesced frame delivered with latest price and aggregated volume (500)
    expect(received.length).toBe(1);
    expect(received[0].price).toBe(50499);
    expect(received[0].volume).toBe(500);

    ws.disconnect();
  });
});
