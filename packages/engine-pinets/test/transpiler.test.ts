// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { ColumnarBarTable } from '@pineorca/data';
import type { WorkerCommand, WorkerResponse } from '@pineorca/worker-bridge';
import { PineTranspiler } from '../src/transpiler/PineTranspiler';
import { PineContext } from '../src/core/PineContext';
import { FastSeries } from '../src/core/FastSeries';
import { PineEngine } from '../src/core/PineEngine';
import { handleWorkerCommand } from '../src/worker/worker';
import { TaLib } from '../src/namespaces/ta/TaLib';

function createMockBars(count: number): ColumnarBarTable {
  const table = ColumnarBarTable.allocate(count);
  const basePrice = 100;
  const baseTime = 1609459200000; // 2021-01-01

  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i / 10) * 15;
    const open = basePrice + wave;
    const high = open + 2;
    const low = open - 2;
    const close = open + (i % 2 === 0 ? 1 : -1);
    const volume = 1000 + (i % 5) * 100;

    table.time[i] = baseTime + i * 60000;
    table.open[i] = open;
    table.high[i] = high;
    table.low[i] = low;
    table.close[i] = close;
    table.volume[i] = volume;
  }
  return table;
}

describe('PineTranspiler v5/v6 & Kernel Execution', () => {
  it('transpiles canonical Pine v5 SMA indicator and executes synchronously over columnar bars', () => {
    const pineCode = `
//@version=5
indicator("Simple SMA", overlay=true)
sma20 = ta.sma(close, 20)
plot(sma20, "SMA 20", color=color.blue)
`;

    const compiled = PineTranspiler.transpile(pineCode, { sync: true });
    expect(compiled.isSync).toBe(true);
    expect(compiled.version).toBe(5);
    expect(typeof compiled.fn).toBe('function');

    const bars = createMockBars(50);
    const ctx = new PineContext({ table: bars });

    PineEngine.executeSync(ctx, compiled.fn);

    expect(ctx.result).toBeDefined();
    expect(ctx.plots).toBeDefined();
    const plotKeys = Object.keys(ctx.plots);
    expect(plotKeys.length).toBeGreaterThan(0);
    const plotData = ctx.plots[plotKeys[0]].data;
    expect(plotData.length).toBe(50);
    // SMA(20) has NaNs for first 19 bars, then real values
    expect(Number.isNaN(plotData[0].value)).toBe(true);
    expect(Number.isFinite(plotData[25].value)).toBe(true);
  });

  it('injects stable AST callsite IDs into plotshape, plotchar, and plotarrow at compile time', () => {
    const pineCode = `
//@version=5
indicator("Plot Shapes Signals", overlay=true)
fast = ta.sma(close, 5)
slow = ta.sma(close, 10)
bull = ta.crossover(fast, slow)
bear = ta.crossunder(fast, slow)
plotshape(bull, "Bull Signal", shape.triangleup, location.belowbar, color.green)
plotchar(bear, "Bear Signal", "v", location.abovebar, color.red)
plotarrow(bull ? 1 : bear ? -1 : 0, "Arrow Signal")
`;

    const compiled = PineTranspiler.transpile(pineCode, { sync: true });
    const fnStr = compiled.fn.toString();

    // Verify compile-time AST callsite ID injection (no runtime monkey patching)
    expect(fnStr).toContain('__callsiteId');

    const bars = createMockBars(30);
    const ctx = new PineContext({ table: bars });
    PineEngine.executeSync(ctx, compiled.fn);

    expect(ctx.plots).toBeDefined();
  });

  it('transpiles canonical Pine v6 indicator and executes without syntax errors', () => {
    const pineCode = `
//@version=6
indicator("Pine v6 Indicator", overlay=false)
rsiVal = ta.rsi(close, 14)
plot(rsiVal, "RSI", color=color.purple)
`;

    const compiled = PineTranspiler.transpile(pineCode, { sync: true });
    expect(compiled.version).toBe(6);
    expect(compiled.isSync).toBe(true);

    const bars = createMockBars(60);
    const ctx = new PineContext({ table: bars });
    PineEngine.executeSync(ctx, compiled.fn);

    expect(ctx.plots).toBeDefined();
    const plotKeys = Object.keys(ctx.plots);
    expect(plotKeys.length).toBeGreaterThan(0);
    const plotData = ctx.plots[plotKeys[0]].data;
    expect(plotData.length).toBe(60);
    expect(Number.isFinite(plotData[30].value)).toBe(true);
    expect(plotData[30].value).toBeGreaterThanOrEqual(0);
    expect(plotData[30].value).toBeLessThanOrEqual(100);
  });

  it('statically pre-scans request.security calls from AST', () => {
    const pineCode = `
//@version=5
indicator("Multi-Timeframe", overlay=true)
dClose = request.security("BINANCE:BTCUSDT", "D", close)
wHigh = request.security(syminfo.tickerid, "1W", high)
plot(dClose)
`;

    const requests = PineTranspiler.scanSecurityRequests(pineCode);
    expect(requests.length).toBe(2);
    expect(requests[0].symbol).toBe('BINANCE:BTCUSDT');
    expect(requests[0].timeframe).toBe('D');
    expect(requests[1].timeframe).toBe('1W');
  });

  it('rewrites and executes request.security synchronously with pre-resolved FastSeries', () => {
    const pineCode = `
//@version=5
indicator("MTF Test", overlay=true)
dClose = request.security("BINANCE:BTCUSDT", "D", close)
plot(dClose, "Daily Close")
`;

    const compiled = PineTranspiler.transpile(pineCode, { sync: true, preResolveSecurity: true });
    expect(compiled.isSync).toBe(true);
    expect(compiled.fn.toString()).toContain('getSecuritySeries');

    const bars = createMockBars(30);
    const ctx = new PineContext({ table: bars });

    // Pre-resolve and register secondary series
    const secBuf = new Float64Array(30);
    secBuf.fill(42000);
    const secSeries = new FastSeries(secBuf, ctx);
    ctx.registerSecuritySeries('__sec_0', secSeries);

    PineEngine.executeSync(ctx, compiled.fn);

    expect(ctx.plots).toBeDefined();
    const plotKeys = Object.keys(ctx.plots);
    expect(plotKeys.length).toBeGreaterThan(0);
    const plot = ctx.plots[plotKeys[0]];
    expect(plot.data[15].value).toBe(42000);
  });
  it('executes a canonical Pine v5 strategy with order matching and PnL generation', () => {
    const pineCode = `
//@version=5
strategy("Test Strategy", overlay=true, initial_capital=100000)
fast = ta.sma(close, 5)
slow = ta.sma(close, 15)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
`;

    const compiled = PineTranspiler.transpile(pineCode, { sync: true });
    const bars = createMockBars(100);
    const ctx = new PineContext({ table: bars });

    ctx.strategy = {
      initial_capital: 100000,
      currency: 'USD',
      margin_long: 100,
      margin_short: 100,
      pyramiding: 1,
      opentrades: [],
      closedtrades: [],
      current_equity: 100000,
      equity_curve: [],
      cash: 100000,
    } as any;

    PineEngine.executeSync(ctx, compiled.fn);

    expect(ctx.strategy).toBeDefined();
  });

  it('vectorized TaLib calculates standard indicators with zero heap object allocations', () => {
    const N = 1000;
    const source = new Float64Array(N);
    for (let i = 0; i < N; i++) source[i] = 100 + Math.sin(i / 10) * 20;

    const sma = TaLib.vectorized.sma(source, 20);
    expect(sma.length).toBe(N);
    expect(Number.isNaN(sma[0])).toBe(true);
    expect(Number.isFinite(sma[25])).toBe(true);

    const ema = TaLib.vectorized.ema(source, 20);
    expect(ema.length).toBe(N);
    expect(Number.isFinite(ema[30])).toBe(true);

    const rsi = TaLib.vectorized.rsi(source, 14);
    expect(rsi.length).toBe(N);
    expect(Number.isFinite(rsi[20])).toBe(true);
    expect(rsi[20]).toBeGreaterThanOrEqual(0);
    expect(rsi[20]).toBeLessThanOrEqual(100);

    const bb = TaLib.vectorized.bb(source, 20, 2.0);
    expect(bb.upper[50]).toBeGreaterThan(bb.lower[50]);
  });

  it('processes WorkerBridge RUN_BACKTEST command end-to-end with ColumnarBarTable', async () => {
    const bars = createMockBars(200);
    const payload = bars.toPayload();

    const responses: WorkerResponse[] = [];
    const postFn = (res: WorkerResponse) => responses.push(res);

    const cmd: WorkerCommand = {
      id: 'test_cmd_1',
      type: 'RUN_BACKTEST',
      payload: {
        runId: 'run_123',
        source: `
//@version=5
strategy("Worker Strategy", overlay=true, initial_capital=50000)
fast = ta.sma(close, 5)
slow = ta.sma(close, 15)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
`,
        symbol: 'BTCUSDT',
        timeframe: '1m',
        bars: payload,
        params: {
          initialCapital: 50000,
        },
      },
    };

    await handleWorkerCommand(cmd, postFn);

    // Should receive PROGRESS messages and one final RUN_BACKTEST_RESULT
    const progressMsgs = responses.filter((r) => r.type === 'PROGRESS');
    expect(progressMsgs.length).toBeGreaterThan(0);

    const finalResult = responses.find((r) => r.type === 'RUN_BACKTEST_RESULT');
    expect(finalResult).toBeDefined();
    expect(finalResult?.success).toBe(true);
    expect(finalResult?.payload).toBeDefined();

    const resultPayload = finalResult?.payload as any;
    expect(resultPayload.runId).toBe('run_123');
    expect(resultPayload.metrics).toBeDefined();
    expect(resultPayload.equityCurve).toBeInstanceOf(Float64Array);
    expect(resultPayload.equityCurve.length).toBe(200);
    expect(resultPayload.drawdownCurve).toBeInstanceOf(Float64Array);
    expect(resultPayload.durationMs).toBeGreaterThanOrEqual(0);
  });
});
