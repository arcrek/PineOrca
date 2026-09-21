// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDOM, type MockHTMLElement } from './setup-dom.js';
import { PineOrcaWorkspace } from '../src/workspace/PineOrcaWorkspace.js';

describe('PineOrcaWorkspace Component', () => {
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

  it('mounts complete workspace hierarchy and binds components', () => {
    const workspace = new PineOrcaWorkspace({
      topBar: { symbol: 'BINANCE:BTCUSDT', timeframe: '15m' },
      initialDockHeight: 350,
      initialDockState: 'split',
    });

    workspace.mount(container as unknown as HTMLElement);

    expect(workspace.getElement()).not.toBeNull();
    expect(workspace.getTopBar()).toBeDefined();
    expect(workspace.getTopBar().getSymbol()).toBe('BINANCE:BTCUSDT');
    expect(workspace.getTopBar().getTimeframe()).toBe('15m');

    const chartContainer = workspace.getChartContainer();
    expect(chartContainer).toBeDefined();
    expect(chartContainer.className).toContain('pineorca-chart-host');

    const bottomDock = workspace.getBottomDock();
    expect(bottomDock).toBeDefined();
    expect(bottomDock.getState()).toBe('split');
    expect(bottomDock.getActiveTab()).toBe('tester');

    const strategyTester = workspace.getStrategyTester();
    expect(strategyTester).toBeDefined();

    const editor = workspace.getEditor();
    expect(editor).toBeDefined();

    const crossProbe = workspace.getCrossProbeController();
    expect(crossProbe).toBeDefined();

    workspace.destroy();
    expect(workspace.getElement()).toBeNull();
  });

  it('notifies resize listeners when bottom dock changes height or state', () => {
    const workspace = new PineOrcaWorkspace({
      initialDockHeight: 300,
    });
    workspace.mount(container as unknown as HTMLElement);

    const onResize = vi.fn();
    const unbind = workspace.onResize(onResize);

    const bottomDock = workspace.getBottomDock();
    bottomDock.setHeight(400);

    expect(onResize).toHaveBeenCalled();

    unbind();
    workspace.destroy();
  });

  it('throws error if chartContainer is accessed before mounting', () => {
    const workspace = new PineOrcaWorkspace();
    expect(() => workspace.getChartContainer()).toThrow(
      'Workspace must be mounted before accessing chartContainer',
    );
  });
});
