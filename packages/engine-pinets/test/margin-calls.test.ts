// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { ColumnarBarTable } from '@pineorca/data';
import { PineContext } from '../src/core/PineContext';
import {
  computeRequiredMargin,
  computeEquityAtPrice,
  computeHeldMargin,
  processMarginCall,
  applyPendingCloseMarginCall,
  openTrade,
  initializeStrategy,
  finalizeStrategyBar,
} from '../src/broker';

function createMarginContext(
  bars: Array<{ open: number; high: number; low: number; close: number; time?: number }>,
  config: any = {},
) {
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
    title: 'Margin Strategy',
    overlay: true,
    initial_capital: 100000,
    currency: 'USD',
    margin_long: 100,
    margin_short: 100,
    ...config,
  });
  return ctx;
}

describe('MarginCallEngine & Multi-Checkpoint Parity', () => {
  it('computeRequiredMargin calculates required collateral given leverage %', () => {
    // 5 contracts at $50,000 with 100% margin (1x)
    expect(computeRequiredMargin(5, 50000, 100, 1)).toBe(250000);

    // 5 contracts at $50,000 with 20% margin (5x leverage)
    expect(computeRequiredMargin(5, 50000, 20, 1)).toBe(50000);

    // Short position (-5 contracts) uses absolute quantity
    expect(computeRequiredMargin(-5, 50000, 20, 1)).toBe(50000);
  });

  it('computes equity and held margin at specified price checkpoint', () => {
    const ctx = createMarginContext([{ open: 100, high: 110, low: 90, close: 100 }], {
      initial_capital: 10000,
      margin_long: 50,
    });
    ctx.idx = 0;

    // Open long 100 units at $100 -> Cost = $10,000, Required Margin = $5,000 (50%)
    openTrade(ctx, 'buy1', 1, 100, 100, 1000);

    // At price $100, equity is $10,000, held margin is $5,000
    expect(computeEquityAtPrice(ctx, 100)).toBe(10000);
    expect(computeHeldMargin(ctx, 100)).toBe(5000);

    // At price $90, unrealized loss is -$1,000 -> equity is $9,000
    expect(computeEquityAtPrice(ctx, 90)).toBe(9000);
    expect(computeHeldMargin(ctx, 90)).toBe(4500);
  });

  it('liquidates position using 4x deficit cover buffer formula', () => {
    // Initial capital $5,000, margin_long = 100%, 100 units at $100 ($10,000 notional, 2x leveraged).
    // Price drops to $80:
    // Equity at $80 = 5000 + (80 - 100) * 100 = $3,000
    // Required margin at $80 = 100 * 80 = $8,000
    // Deficit = $8,000 - $3,000 = $5,000
    // Cover Qty = Deficit / (Price * pointValue * marginFrac) = 5000 / (80 * 1 * 1.0) = 62.5 units
    // 4x Deficit Cover = 4 * 62.5 = 250 units
    // Since total position is 100 units, min(100, 250) = 100 units liquidated (full liquidation)
    const ctx = createMarginContext([{ open: 100, high: 105, low: 80, close: 85 }], {
      initial_capital: 5000,
      margin_long: 100,
    });
    ctx.idx = 0;
    openTrade(ctx, 'long1', 1, 100, 100, 1000);

    // Process margin call at extreme (low = 80)
    processMarginCall(ctx, 'extreme');

    // Fully liquidated
    expect(ctx.strategy.position_size).toBe(0);
    expect(ctx.strategy.opentrades.length).toBe(0);
    expect(ctx.strategy.closedtrades.length).toBe(1);
    expect(ctx.strategy.closedtrades[0].exit_id).toBe('Margin call');
  });

  it('handles partial liquidation: BTCUSDT 1D leveraged short 4x cover deficit scenario', () => {
    // Short 5 contracts entered at 80,000:
    // Adverse price = 100,000.
    // Deficit is small: Equity = $475,000, Required = $500,000 -> Deficit = $25,000.
    // Cover Qty = 25,000 / 100,000 = 0.25.
    // 4x Cover = 4 * 0.25 = 1.0 contract liquidated.
    // Remaining position = 4.0 contracts open!
    const ctx = createMarginContext([{ open: 80000, high: 100000, low: 79000, close: 95000 }], {
      initial_capital: 575000, // At 100,000: Equity = 575,000 + (80000 - 100000)*5 = $475,000
      margin_short: 100,
    });
    ctx.idx = 0;
    openTrade(ctx, 'short_btc', -1, 5, 80000, 1000);
    expect(ctx.strategy.position_size).toBe(-5);

    // Trigger margin call at extreme (high = 100,000)
    processMarginCall(ctx, 'extreme');

    // Liquidated exactly 1.0 contract
    expect(ctx.strategy.closedtrades.length).toBe(1);
    expect(Math.abs(ctx.strategy.closedtrades[0].size)).toBeCloseTo(1.0, 5);
    expect(ctx.strategy.closedtrades[0].exit_price).toBe(100000);
    expect(ctx.strategy.closedtrades[0].exit_id).toBe('Margin call');

    // Remaining position is 4.0 contracts
    expect(ctx.strategy.position_size).toBe(-4);
    expect(ctx.strategy.opentrades.length).toBe(1);
    expect(ctx.strategy.opentrades[0].size).toBe(-4);
  });

  it('records pending close margin call when breach happens at bar close', () => {
    const ctx = createMarginContext(
      [
        { open: 100, high: 105, low: 95, close: 60 },
        { open: 60, high: 65, low: 55, close: 58 },
      ],
      {
        initial_capital: 6000,
        margin_long: 100,
      },
    );
    ctx.idx = 0;
    openTrade(ctx, 'buy1', 1, 100, 100, 1000);

    // Set pending close margin call for bar 1 open
    (ctx.strategy as any)._pending_close_mc = {
      dir: 1,
      qty: 50,
      price: 60,
      time: 1000,
    };
    expect((ctx.strategy as any)._pending_close_mc).toBeDefined();

    // Next bar applies the pending margin call at open
    ctx.idx = 1;
    applyPendingCloseMarginCall(ctx);

    // Pending call consumed and position liquidated
    expect((ctx.strategy as any)._pending_close_mc).toBeNull();
    expect(ctx.strategy.closedtrades.length).toBe(1);
    expect(Math.abs(ctx.strategy.closedtrades[0].size)).toBe(50);
    expect(ctx.strategy.position_size).toBe(50);
  });
});
