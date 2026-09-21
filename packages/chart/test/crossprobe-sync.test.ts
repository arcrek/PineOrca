// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VelaChartAdapter } from '../src/VelaChartAdapter.js';
import { TradeMarkerLayer } from '../src/markers/TradeMarkerLayer.js';
import { ColumnarBarTable } from '@pineorca/data';
import type { TradeExecution } from '@luxalgo/vela/plugin';

describe('VelaChartAdapter — Viewport Centering & CrossProbe Sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates viewport window and centers on timestamp', () => {
    const adapter = new VelaChartAdapter();

    const mockVela = {
      visibleRange: { from: 100_000, to: 200_000 },
      getVisibleRange() {
        return this.visibleRange;
      },
      setVisibleRange: vi.fn((range: { from: number; to: number }) => {
        mockVela.visibleRange = range;
      }),
    };

    (adapter as any).vela = mockVela;

    // Target timestamp: 500,000. Current span: 100,000ms.
    // Half span: 50,000ms -> Expected range: [450,000, 550,000]
    adapter.centerOnTime(500_000);

    expect(mockVela.setVisibleRange).toHaveBeenCalledWith({
      from: 450_000,
      to: 550_000,
    });

    adapter.destroy();
  });

  it('falls back to scrollToTime if setVisibleRange is not available', () => {
    const adapter = new VelaChartAdapter();

    const mockVela = {
      scrollToTime: vi.fn(),
    };

    (adapter as any).vela = mockVela;

    adapter.centerOnTime(300_000);

    expect(mockVela.scrollToTime).toHaveBeenCalledWith(300_000);

    adapter.destroy();
  });

  it('triggers pulseGlow on marker layer and automatically clears after timeout', () => {
    const layer = new TradeMarkerLayer();
    expect(layer.getActivePulsingTradeId()).toBeNull();

    layer.pulseGlow('trade-institutional-1');
    expect(layer.getActivePulsingTradeId()).toBe('trade-institutional-1');

    // Before 1200ms
    vi.advanceTimersByTime(600);
    expect(layer.getActivePulsingTradeId()).toBe('trade-institutional-1');

    // Past 1200ms
    vi.advanceTimersByTime(650);
    expect(layer.getActivePulsingTradeId()).toBeNull();
  });

  it('delegates pulseGlow through VelaChartAdapter to TradeMarkerLayer', () => {
    const adapter = new VelaChartAdapter();
    adapter.pulseGlow('T-99');

    expect(adapter.getMarkerLayer().getActivePulsingTradeId()).toBe('T-99');

    vi.advanceTimersByTime(1200);
    expect(adapter.getMarkerLayer().getActivePulsingTradeId()).toBeNull();

    adapter.destroy();
  });

  it('routes real-time candle update to Vela instance', () => {
    const adapter = new VelaChartAdapter();

    const mockVela = {
      updateCandle: vi.fn(),
    };

    (adapter as any).vela = mockVela;

    const candle = {
      time: 1609459200000,
      open: 100,
      high: 105,
      low: 98,
      close: 104,
      volume: 1200,
    };

    adapter.updateCandle(candle);

    expect(mockVela.updateCandle).toHaveBeenCalledWith(candle);

    adapter.destroy();
  });

  it('executes bidirectional cross-probe synchronization within sub-16ms latency threshold', () => {
    vi.useRealTimers();

    const adapter = new VelaChartAdapter();
    const mockVela = {
      visibleRange: { from: 1000, to: 61000 },
      getVisibleRange() {
        return this.visibleRange;
      },
      setVisibleRange: vi.fn(),
    };
    (adapter as any).vela = mockVela;

    const trades: TradeExecution[] = [
      {
        tradeId: 'trade-cross-1',
        time: 50_000,
        price: 100,
        side: 'buy',
        kind: 'entry',
      },
    ];
    adapter.setTrades(trades);

    const start = performance.now();

    // 1. Table -> Chart selection simulation
    adapter.centerOnTime(50_000);
    adapter.selectTrade('trade-cross-1');
    adapter.pulseGlow('trade-cross-1');

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(16); // Institutional sub-16ms budget
    expect(adapter.getMarkerLayer().getActivePulsingTradeId()).toBe('trade-cross-1');
    expect(mockVela.setVisibleRange).toHaveBeenCalledWith({
      from: 20_000,
      to: 80_000,
    });

    adapter.destroy();
  });


  it('sets bars from ColumnarBarTable and calls setMarket on Vela', async () => {
    const adapter = new VelaChartAdapter();
    const mockVela = {
      setMarket: vi.fn().mockResolvedValue(undefined),
    };
    (adapter as any).vela = mockVela;

    const table = ColumnarBarTable.fromBars([
      { time: 1000, open: 100, high: 110, low: 95, close: 105, volume: 50 },
      { time: 2000, open: 105, high: 115, low: 100, close: 110, volume: 60 },
    ]);

    await adapter.setBars(table);

    expect(mockVela.setMarket).toHaveBeenCalledWith({
      data: [
        { time: 1000, open: 100, high: 110, low: 95, close: 105, volume: 50 },
        { time: 2000, open: 105, high: 115, low: 100, close: 110, volume: 60 },
      ],
    });

    adapter.destroy();
  });

  it('sets bars from OHLCV array and calls setMarket on Vela', async () => {
    const adapter = new VelaChartAdapter();
    const mockVela = {
      setMarket: vi.fn().mockResolvedValue(undefined),
    };
    (adapter as any).vela = mockVela;

    const bars = [
      { time: 5000, open: 50, high: 60, low: 45, close: 55, volume: 10 },
    ];

    await adapter.setBars(bars);

    expect(mockVela.setMarket).toHaveBeenCalledWith({ data: bars });

    adapter.destroy();
  });
});
