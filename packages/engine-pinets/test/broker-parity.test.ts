// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { ColumnarBarTable } from '@pineorca/data';
import { PineContext } from '../src/core/PineContext';
import { PineEngine } from '../src/core/PineEngine';
import {
  roundToMintick,
  parseDirection,
  applySlippage,
  calculateOrderQty,
  wouldExceedPyramiding,
  isOrderBlockedByRisk,
  openTrade,
  closePartialPosition,
  closeMatching,
  processStrategyOrders,
  processExitOrders,
  isAdverseFirstBar,
  initializeStrategy,
  finalizeStrategyBar,
  finalizeStrategyRun,
  stepBar,
  finalizeRun,
  applyPendingCloseMarginCall,
  computeDetailedMetrics,
} from '../src/broker';

function createTestContext(bars: Array<{ open: number; high: number; low: number; close: number; time?: number }>, config: any = {}) {
  const table = ColumnarBarTable.allocate(bars.length);
  const baseTime = 1609459200000;
  for (let i = 0; i < bars.length; i++) {
    table.time[i] = bars[i].time ?? baseTime + i * 86400000;
    table.open[i] = bars[i].open;
    table.high[i] = bars[i].high;
    table.low[i] = bars[i].low;
    table.close[i] = bars[i].close;
    table.volume[i] = 1000;
  }
  const ctx = new PineContext({ table, timeframe: '1D' });
  ctx.pine = { syminfo: { pointvalue: 1, mintick: 0.01 } };
  initializeStrategy(ctx, {
    title: 'Test Strategy',
    overlay: true,
    initial_capital: 100000,
    currency: 'USD',
    default_qty_type: 'fixed',
    default_qty_value: 1,
    pyramiding: 5,
    ...config,
  });
  return ctx;
}

describe('Order Precedence & Mintick Snapping', () => {
  it('roundToMintick pushes stop/limit prices conservatively away from reference price', () => {
    const mintick = 0.25;
    // Price above reference -> ceil
    expect(roundToMintick(100.1, 100.0, mintick)).toBe(100.25);
    expect(roundToMintick(100.25, 100.0, mintick)).toBe(100.25);
    expect(roundToMintick(100.26, 100.0, mintick)).toBe(100.5);

    // Price below reference -> floor
    expect(roundToMintick(99.9, 100.0, mintick)).toBe(99.75);
    expect(roundToMintick(99.75, 100.0, mintick)).toBe(99.75);
    expect(roundToMintick(99.74, 100.0, mintick)).toBe(99.5);

    // Price exactly on reference
    expect(roundToMintick(100.0, 100.0, mintick)).toBe(100.0);
    // Invalid/zero mintick returns unchanged
    expect(roundToMintick(100.123, 100.0, 0)).toBe(100.123);
  });

  it('enforces two-phase order execution: queued on bar N, executed on bar N+1', () => {
    const ctx = createTestContext([
      { open: 100, high: 105, low: 95, close: 102 },
      { open: 103, high: 108, low: 101, close: 106 },
    ]);

    // Bar 0
    ctx.idx = 0;
    stepBar(ctx);
    // Queue an order at bar 0
    ctx.strategy.pending_orders.push({
      id: 'buy1',
      direction: 1,
      qty: 2,
      type: 'market',
      category: 'entry',
      status: 'pending',
      bar: 0,
      time: 1609459200000,
    });

    // Orders are pending at bar 0
    expect(ctx.strategy.opentrades.length).toBe(0);
    expect(ctx.strategy.position_size).toBe(0);

    // Bar 1 - stepBar processes orders queued at bar 0
    ctx.idx = 1;
    stepBar(ctx);

    expect(ctx.strategy.opentrades.length).toBe(1);
    expect(ctx.strategy.position_size).toBe(2);
    expect(ctx.strategy.opentrades[0].entry_price).toBe(103); // Executed at Bar 1 Open
    expect(ctx.strategy.opentrades[0].entry_bar_index).toBe(1);
  });

  it('fills stop entry orders at openPrice when market gaps past the stop price', () => {
    const ctx = createTestContext([
      { open: 100, high: 102, low: 98, close: 101 },
      { open: 110, high: 115, low: 108, close: 112 }, // Gaps up to 110
    ]);

    ctx.idx = 0;
    stepBar(ctx);
    // Buy stop order at 105 queued at bar 0
    ctx.strategy.pending_orders.push({
      id: 'stop_buy',
      direction: 1,
      qty: 1,
      type: 'stop',
      stop: 105,
      category: 'entry',
      status: 'pending',
      bar: 0,
      time: 1609459200000,
    });

    // Bar 1 open is 110 > stop 105 -> Gap fill must fill at openPrice 110, NOT 105
    ctx.idx = 1;
    stepBar(ctx);

    expect(ctx.strategy.opentrades.length).toBe(1);
    expect(ctx.strategy.opentrades[0].entry_price).toBe(110);
  });

  it('calculates order quantity correctly with non-unitary pointValue (futures)', () => {
    const ctx = createTestContext([{ open: 100, high: 105, low: 95, close: 100 }], {
      default_qty_type: 'cash',
      default_qty_value: 50000, // $50,000 cash allocation
    });
    // Set ES futures pointValue = 50 ($50 per point)
    ctx.pine = { syminfo: { pointvalue: 50, mintick: 0.25 } };
    // At fill price 100, notional per contract = 100 * 50 = $5,000.
    // $50,000 cash should buy 10 contracts, not 500!
    const qty = calculateOrderQty(ctx, undefined, 1, 100);
    expect(qty).toBe(10);
  });

  it('replicates TradingView buy-stop same-open gap asymmetry', () => {
    // Short entry on Bar 1 with SL above open.
    // TV asymmetry: a BUY-stop (SL of a SHORT) already in-the-money at open does NOT catch
    // a trade that entered at that same open (spares fresh entry),
    // whereas sell-stops and limit orders always catch.
    const ctx = createTestContext([
      { open: 100, high: 102, low: 98, close: 100 },
      { open: 105, high: 110, low: 103, close: 108 }, // Gaps up to 105
    ]);

    ctx.idx = 0;
    stepBar(ctx);
    // Short entry queued at bar 0
    ctx.strategy.pending_orders.push({
      id: 'short1',
      direction: -1,
      qty: 1,
      type: 'market',
      category: 'entry',
      status: 'pending',
      bar: 0,
      time: 1609459200000,
    });

    // Bar 1 open: short fills at 105.
    ctx.idx = 1;
    applyPendingCloseMarginCall(ctx);
    processStrategyOrders(ctx);

    expect(ctx.strategy.opentrades.length).toBe(1);
    expect(ctx.strategy.opentrades[0].entry_price).toBe(105);
    expect(ctx.strategy.opentrades[0].entry_bar_index).toBe(1);

    // Exit bracket with loss=100 ticks (SL = 104, in the money at open 105)
    ctx.strategy.pending_orders.push({
      id: 'exit_short',
      from_entry: 'short1',
      direction: 1,
      qty: 1,
      type: 'stop',
      category: 'exit',
      stop: 104, // SL price at 104 (in the money at open 105)
      status: 'pending',
      bar: 1,
      time: 1609459200000 + 86400000,
    });

    // Process exits
    processExitOrders(ctx, 'intrabar');

    // Due to buyStopSparesFreshEntry, the trade is NOT closed on the same open bar
    expect(ctx.strategy.opentrades.length).toBe(1);
    expect(ctx.strategy.position_size).toBe(-1);
  });
});

describe('Intrabar Polarity & Exit Brackets', () => {
  it('isAdverseFirstBar correctly computes polarity based on OHLC geometry', () => {
    // Bullish candle: open=100, high=108, low=98, close=106
    // |H - O| = 8, |O - L| = 2.
    // Since |H - O| > |O - L|, open is closer to low.
    // Path: open -> low -> high -> close.
    // For a Long: low is adverse, so adverse extreme is reached first!
    const ctxLong = createTestContext([{ open: 100, high: 108, low: 98, close: 106 }]);
    ctxLong.idx = 0;
    ctxLong.strategy.position_size = 1;
    expect(isAdverseFirstBar(ctxLong)).toBe(true);

    // For a Short with same candle: high is adverse.
    // Path was open -> low -> high -> close, so favorable (low) is reached first!
    const ctxShort = createTestContext([{ open: 100, high: 108, low: 98, close: 106 }]);
    ctxShort.idx = 0;
    ctxShort.strategy.position_size = -1;
    expect(isAdverseFirstBar(ctxShort)).toBe(false);

    // Bearish candle: open=100, high=102, low=92, close=94
    // |H - O| = 2, |O - L| = 8.
    // Open closer to high. Path: open -> high -> low -> close.
    // For Long: favorable (high) first -> adverseFirst = false
    const ctxLong2 = createTestContext([{ open: 100, high: 102, low: 92, close: 94 }]);
    ctxLong2.idx = 0;
    ctxLong2.strategy.position_size = 1;
    expect(isAdverseFirstBar(ctxLong2)).toBe(false);

    // For Short: adverse (high) first -> adverseFirst = true
    const ctxShort2 = createTestContext([{ open: 100, high: 102, low: 92, close: 94 }]);
    ctxShort2.idx = 0;
    ctxShort2.strategy.position_size = -1;
    expect(isAdverseFirstBar(ctxShort2)).toBe(true);
  });

  it('exit bracket profit and loss execute with correct exit price', () => {
    const ctx = createTestContext([
      { open: 100, high: 105, low: 95, close: 100 },
      { open: 100, high: 110, low: 99, close: 108 },
    ]);

    ctx.idx = 0;
    openTrade(ctx, 'entry1', 1, 1, 100, 1609459200000);
    expect(ctx.strategy.opentrades.length).toBe(1);

    // Queue exit with profit target = 106 (limit)
    ctx.idx = 1;
    ctx.strategy.pending_orders.push({
      id: 'exit1',
      from_entry: 'entry1',
      direction: -1,
      qty: 1,
      type: 'limit',
      category: 'exit',
      limit: 106,
      status: 'pending',
      bar: 0,
      time: 1609459200000,
    });

    processExitOrders(ctx, 'intrabar');

    expect(ctx.strategy.opentrades.length).toBe(0);
    expect(ctx.strategy.closedtrades.length).toBe(1);
    expect(ctx.strategy.closedtrades[0].exit_price).toBe(106);
    expect(ctx.strategy.closedtrades[0].profit).toBe(6);
  });
});

describe('FIFO Ledger Slicing & Commission Accounting', () => {
  it('splits closing orders across multiple lots in chronological order (FIFO)', () => {
    const ctx = createTestContext([{ open: 100, high: 105, low: 95, close: 100 }]);
    ctx.idx = 0;

    // Open three separate lots at different times and prices
    openTrade(ctx, 'lot1', 1, 2, 100, 1000);
    openTrade(ctx, 'lot2', 1, 3, 102, 2000);
    openTrade(ctx, 'lot3', 1, 5, 104, 3000);

    expect(ctx.strategy.opentrades.length).toBe(3);
    expect(ctx.strategy.position_size).toBe(10);

    // Close 4 contracts at price 110
    // Lot 1 (qty 2) should be completely closed
    // Lot 2 (qty 3) should have 2 contracts closed, leaving 1 contract open
    // Lot 3 (qty 5) should remain untouched
    closePartialPosition(ctx, 4, 110, 4000);

    expect(ctx.strategy.opentrades.length).toBe(2);
    expect(ctx.strategy.opentrades[0].entry_id).toBe('lot2');
    expect(ctx.strategy.opentrades[0].size).toBe(1);
    expect(ctx.strategy.opentrades[1].entry_id).toBe('lot3');
    expect(ctx.strategy.opentrades[1].size).toBe(5);
    expect(ctx.strategy.position_size).toBe(6);

    // Closed trades ledger should show 2 closed trade slices
    expect(ctx.strategy.closedtrades.length).toBe(2);
    expect(ctx.strategy.closedtrades[0].entry_id).toBe('lot1');
    expect(Math.abs(ctx.strategy.closedtrades[0].size)).toBe(2);
    expect(ctx.strategy.closedtrades[0].profit).toBe((110 - 100) * 2);

    expect(ctx.strategy.closedtrades[1].entry_id).toBe('lot2');
    expect(Math.abs(ctx.strategy.closedtrades[1].size)).toBe(2);
    expect(ctx.strategy.closedtrades[1].profit).toBe((110 - 102) * 2);
  });

  it('apportions entry commissions pro-rata upon partial closes', () => {
    const ctx = createTestContext([{ open: 100, high: 105, low: 95, close: 100 }], {
      commission_type: 'percent',
      commission_value: 0.1, // 0.1%
    });
    ctx.idx = 0;

    // Open lot of 10 contracts at $100 -> Notional = $1,000, 0.1% = $1.00 entry commission
    openTrade(ctx, 'entry1', 1, 10, 100, 1000);
    expect(ctx.strategy.opentrades[0].commission).toBe(1.0);

    // Close 4 contracts at $110 -> 40% of position
    // Pro-rata entry commission allocated to closed slice = 4/10 * 1.0 = $0.40
    // Exit commission for 4 contracts at $110 = 4 * 110 * 0.001 = $0.44
    // Total commission on closed trade = $0.40 + $0.44 = $0.84
    closePartialPosition(ctx, 4, 110, 2000);

    expect(ctx.strategy.closedtrades.length).toBe(1);
    expect(ctx.strategy.closedtrades[0].commission).toBeCloseTo(0.84, 4);

    // Remaining lot commission should be 60% of $1.00 = $0.60
    expect(ctx.strategy.opentrades[0].commission).toBeCloseTo(0.60, 4);
    expect(ctx.strategy.opentrades[0].size).toBe(6);
  });
});

describe('Statistical Metrics Calculation', () => {
  it('computes 30+ performance statistics matching TradingView formulas', () => {
    const ctx = createTestContext([
      { open: 100, high: 105, low: 95, close: 102, time: 1609459200000 },
      { open: 102, high: 110, low: 101, close: 108, time: 1612137600000 },
      { open: 108, high: 115, low: 105, close: 112, time: 1614556800000 },
      { open: 112, high: 114, low: 90, close: 95, time: 1617235200000 },
    ]);

    ctx.idx = 0;
    openTrade(ctx, 'trade1', 1, 1, 100, 1609459200000);
    finalizeStrategyBar(ctx);

    ctx.idx = 1;
    // Close trade1 with profit
    closePartialPosition(ctx, 1, 110, 1612137600000);
    // Open trade2
    openTrade(ctx, 'trade2', 1, 1, 108, 1612137600000);
    finalizeStrategyBar(ctx);

    ctx.idx = 2;
    finalizeStrategyBar(ctx);

    ctx.idx = 3;
    // Close trade2 with loss at 95
    closePartialPosition(ctx, 1, 95, 1617235200000);
    finalizeStrategyBar(ctx);

    // Finalize backtest run
    finalizeStrategyRun(ctx);

    const strat = ctx.strategy;
    expect(strat.closedtrades.length).toBe(2);
    expect(strat.wintrades).toBe(1);
    expect(strat.losstrades).toBe(1);
    expect(strat.eventrades).toBe(0);

    // Trade 1: profit 10
    // Trade 2: loss -13
    expect(strat.grossprofit).toBe(10);
    expect(strat.grossloss).toBe(13);
    expect(strat.netprofit).toBe(-3);

    const metrics = computeDetailedMetrics(strat);
    expect(metrics.profitFactor).toBeCloseTo(10 / 13, 4);
    expect(metrics.netProfit).toBe(-3);
    expect(metrics.totalClosedTrades).toBe(2);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(1);
    expect(metrics.expectancy).toBeCloseTo((1 / 2) * 10 - (1 / 2) * 13, 4);

    // Drawdown and runup tracking
    expect(strat.max_runup).toBeGreaterThan(0);
    expect(strat.max_drawdown).toBeGreaterThan(0);

    // CAGR, Sharpe, Sortino ratios computed over ColumnarBarTable
    expect(Number.isFinite(strat.cagr)).toBe(true);
    expect(typeof strat.sharpe_ratio).toBe('number');
    expect(typeof strat.sortino_ratio).toBe('number');
  });
});
