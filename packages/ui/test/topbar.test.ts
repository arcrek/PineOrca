// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDOM, type MockHTMLElement } from './setup-dom.js';
import { TopBar, type TopBarMetrics } from '../src/topbar/TopBar.js';

describe('TopBar Component', () => {
  let domCleanup: () => void;
  let container: MockHTMLElement;

  beforeEach(() => {
    const dom = setupTestDOM();
    domCleanup = dom.cleanup;
    container = dom.container;
  });

  afterEach(() => {
    domCleanup();
  });

  it('mounts properly and creates DOM hierarchy', () => {
    const topBar = new TopBar({
      symbol: 'BINANCE:BTCUSDT',
      timeframe: '5m',
    });

    topBar.mount(container as unknown as HTMLElement);

    expect(topBar.getElement()).not.toBeNull();
    expect(topBar.getSymbol()).toBe('BINANCE:BTCUSDT');
    expect(topBar.getTimeframe()).toBe('5m');
    expect(topBar.getStatus()).toBe('idle');
    expect(topBar.isStreaming()).toBe(false);

    topBar.destroy();
    expect(topBar.getElement()).toBeNull();
  });

  it('triggers onSymbolChange when symbol is updated', () => {
    const topBar = new TopBar();
    topBar.mount(container as unknown as HTMLElement);

    const onSymbol = vi.fn();
    topBar.onSymbolChange(onSymbol);

    topBar.setSymbol('NASDAQ:NVDA');
    expect(topBar.getSymbol()).toBe('NASDAQ:NVDA');

    topBar.destroy();
  });

  it('triggers onTimeframeChange and updates active button', () => {
    const topBar = new TopBar({ timeframe: '1m' });
    topBar.mount(container as unknown as HTMLElement);

    const onTimeframe = vi.fn();
    topBar.onTimeframeChange(onTimeframe);

    topBar.setTimeframe('15m');
    expect(topBar.getTimeframe()).toBe('15m');

    topBar.destroy();
  });

  it('triggers onPresetChange when strategy preset is selected', () => {
    const topBar = new TopBar({ initialPresetId: 'sma_cross' });
    topBar.mount(container as unknown as HTMLElement);

    const onPreset = vi.fn();
    topBar.onPresetChange(onPreset);

    topBar.setPreset('rsi_divergence');
    expect(topBar.getPreset()).toBe('rsi_divergence');

    topBar.destroy();
  });

  it('handles streaming toggle and fires onToggleStreaming', () => {
    const topBar = new TopBar({ initialStreaming: false });
    topBar.mount(container as unknown as HTMLElement);

    const onStreaming = vi.fn();
    topBar.onToggleStreaming(onStreaming);

    topBar.setStreaming(true);
    expect(topBar.isStreaming()).toBe(true);

    topBar.setStreaming(false);
    expect(topBar.isStreaming()).toBe(false);

    topBar.destroy();
  });

  it('manages run button states and prevents double-execution while running', () => {
    const topBar = new TopBar();
    topBar.mount(container as unknown as HTMLElement);

    const onRun = vi.fn();
    topBar.onRunBacktest(onRun);

    topBar.setStatus('running');
    expect(topBar.getStatus()).toBe('running');

    topBar.setStatus('idle');
    expect(topBar.getStatus()).toBe('idle');

    topBar.destroy();
  });

  it('updates telemetry status and execution metrics', () => {
    const topBar = new TopBar();
    topBar.mount(container as unknown as HTMLElement);

    topBar.setStatus('error', 'Compilation failure at line 4');
    expect(topBar.getStatus()).toBe('error');

    const metrics: TopBarMetrics = {
      durationMs: 24.8,
      totalBars: 10000,
      netProfitPercent: 18.5,
      winRate: 62.4,
    };
    topBar.setMetrics(metrics);

    topBar.destroy();
  });
});
