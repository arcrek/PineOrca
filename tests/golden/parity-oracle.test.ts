// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ColumnarBarTable } from '@pineorca/data';
import {
  PineTranspiler,
  PineContext,
  PineEngine,
  computeDetailedMetrics,
} from '@pineorca/engine-pinets';

interface FixtureTrade {
  entry_id: string;
  entry_price: number;
  entry_bar_index: number;
  entry_time: number;
  exit_id: string;
  exit_price: number;
  exit_bar_index: number;
  exit_time: number;
  size: number;
  profit: number;
}

interface FixtureMetrics {
  totalClosedTrades: number;
  winningTrades: number;
  losingTrades: number;
  evenTrades: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
}

interface GoldenFixture {
  name: string;
  description: string;
  pineScript: string;
  symbol: string;
  timeframe: string;
  bars: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  expected: {
    metrics: FixtureMetrics;
    trades: FixtureTrade[];
  };
}

function calcRelDivergence(actual: number, expected: number): number {
  if (expected === 0) {
    return Math.abs(actual);
  }
  return Math.abs((actual - expected) / expected);
}

describe('TradingView Parity Oracle & Golden Reference Test Matrix', () => {
  const fixtures = [
    'rsi-mean-reversion.tv.json',
    'bb-pyramiding.tv.json',
    'macd-reversal.tv.json',
    'turtle-trailing.tv.json',
    'crypto-margin-call.tv.json',
  ];

  for (const filename of fixtures) {
    it(`enforces strict float and trade parity on ${filename}`, () => {
      const fixturePath = path.join(__dirname, 'fixtures', filename);
      expect(fs.existsSync(fixturePath)).toBe(true);

      const raw = fs.readFileSync(fixturePath, 'utf8');
      const fixture: GoldenFixture = JSON.parse(raw);

      // 1. Allocate columnar table and pack market data
      const barCount = fixture.bars.length;
      const table = ColumnarBarTable.allocate(barCount);
      for (let i = 0; i < barCount; i++) {
        const b = fixture.bars[i];
        table.time[i] = b.time;
        table.open[i] = b.open;
        table.high[i] = b.high;
        table.low[i] = b.low;
        table.close[i] = b.close;
        table.volume[i] = b.volume;
      }

      // 2. Transpile canonical Pine Script v5/v6 into synchronous execution kernel
      const compiled = PineTranspiler.transpile(fixture.pineScript, { sync: true });
      expect(compiled.isSync).toBe(true);

      // 3. Initialize high-performance PineContext bound to columnar buffers
      const ctx = new PineContext({ table, timeframe: fixture.timeframe });
      ctx.pine.syminfo = { pointvalue: 1, mintick: 0.01 };

      // 4. Synchronous hot-loop execution
      PineEngine.executeSync(ctx, compiled.fn);

      const strategy = ctx.strategy;
      expect(strategy).toBeDefined();

      const metrics = computeDetailedMetrics(strategy);
      const expected = fixture.expected.metrics;

      // 5. Parity Tolerance Enforcement:
      // - Closed Trade Count: 0 mismatch (100% exact match)
      expect(strategy.closedtrades.length).toBe(expected.totalClosedTrades);
      expect(metrics.totalClosedTrades).toBe(expected.totalClosedTrades);

      // - Win / Loss / Even Counts: 0 mismatch
      expect(metrics.winningTrades).toBe(expected.winningTrades);
      expect(metrics.losingTrades).toBe(expected.losingTrades);
      expect(metrics.evenTrades).toBe(expected.evenTrades);

      // - Net Profit: Divergence <= 0.001% (0.00001)
      const netProfitDiv = calcRelDivergence(metrics.netProfit, expected.netProfit);
      expect(netProfitDiv).toBeLessThanOrEqual(0.00001);

      // - Gross Profit & Gross Loss: Divergence <= 0.001% (0.00001)
      const grossProfitDiv = calcRelDivergence(metrics.grossProfit, expected.grossProfit);
      expect(grossProfitDiv).toBeLessThanOrEqual(0.00001);

      const grossLossDiv = calcRelDivergence(metrics.grossLoss, expected.grossLoss);
      expect(grossLossDiv).toBeLessThanOrEqual(0.00001);

      // - Max Drawdown ($ and %): Divergence <= 0.01% (0.0001)
      const maxDrawdownDiv = calcRelDivergence(metrics.maxDrawdown, expected.maxDrawdown);
      expect(maxDrawdownDiv).toBeLessThanOrEqual(0.0001);

      const maxDrawdownPctDiv = calcRelDivergence(metrics.maxDrawdownPercent, expected.maxDrawdownPercent);
      expect(maxDrawdownPctDiv).toBeLessThanOrEqual(0.0001);

      // - Profit Factor: Divergence <= 0.005
      if (Number.isFinite(expected.profitFactor) && Number.isFinite(metrics.profitFactor)) {
        const pfDiv = Math.abs(metrics.profitFactor - expected.profitFactor);
        expect(pfDiv).toBeLessThanOrEqual(0.005);
      }

      // - Individual Trade Fill Prices: Divergence <= 0.0001% (0.000001)
      expect(strategy.closedtrades.length).toBe(fixture.expected.trades.length);
      for (let t = 0; t < strategy.closedtrades.length; t++) {
        const actualTrade = strategy.closedtrades[t];
        const expectedTrade = fixture.expected.trades[t];

        const entryPriceDiv = calcRelDivergence(actualTrade.entry_price, expectedTrade.entry_price);
        expect(entryPriceDiv).toBeLessThanOrEqual(0.000001);

        if (actualTrade.exit_price !== undefined && expectedTrade.exit_price !== undefined) {
          const exitPriceDiv = calcRelDivergence(actualTrade.exit_price, expectedTrade.exit_price);
          expect(exitPriceDiv).toBeLessThanOrEqual(0.000001);
        }

        expect(actualTrade.size).toBe(expectedTrade.size);
      }
    });
  }
});
