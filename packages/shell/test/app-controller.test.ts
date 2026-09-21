// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDOM, type MockHTMLElement } from '../../ui/test/setup-dom.js';
import { AppController } from '../src/controller/AppController.js';
import type {
  WorkerLike,
  WorkerCommand,
  WorkerResponse,
  BacktestResultPayload,
  StreamTickPayload,
  StreamTickResultPayload,
} from '@pineorca/worker-bridge';

class MockAppWorker implements WorkerLike {
  public messagesPosted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  private listeners = new Set<(event: { data: unknown }) => void>();
  public isTerminated = false;

  public postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messagesPosted.push({ message, transfer });

    const cmd = message as WorkerCommand;
    if (!cmd || !cmd.id) return;

    queueMicrotask(() => {
      if (this.isTerminated) return;
      this.handleCommand(cmd);
    });
  }

  public addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  public removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  public terminate(): void {
    this.isTerminated = true;
    this.listeners.clear();
  }

  private handleCommand(cmd: WorkerCommand): void {
    if (cmd.type === 'RUN_BACKTEST') {
      const payload: BacktestResultPayload = {
        runId: (cmd.payload as any).runId,
        metrics: {
          netProfit: 4500,
          netProfitPercent: 4.5,
          grossProfit: 6000,
          grossLoss: 1500,
          profitFactor: 4.0,
          totalTrades: 12,
          winningTrades: 9,
          losingTrades: 3,
          winRate: 75.0,
          maxDrawdown: 400,
          maxDrawdownPercent: 0.4,
          sharpeRatio: 2.1,
          sortinoRatio: 3.2,
          cagr: 28.5,
        },
        trades: [
          {
            tradeId: 'T1',
            entryTime: 1609459200000,
            exitTime: 1609462800000,
            entryPrice: 30000,
            exitPrice: 30500,
            qty: 1,
            profit: 500,
            profitPercent: 1.67,
            side: 'buy',
          },
        ],
        equityCurve: new Float64Array([100000, 100500, 104500]),
        drawdownCurve: new Float64Array([0, 0, 0]),
        durationMs: 16.4,
      };

      for (const l of this.listeners) {
        l({
          data: {
            reqId: cmd.id,
            type: 'RUN_BACKTEST_RESULT',
            success: true,
            payload,
          } satisfies WorkerResponse<BacktestResultPayload>,
        });
      }
      return;
    }

    if (cmd.type === 'STREAM_TICK') {
      const streamPayload = cmd.payload as StreamTickPayload;
      const resPayload: StreamTickResultPayload = {
        runId: streamPayload.runId,
        bar: {
          time: streamPayload.time,
          open: 30500,
          high: Math.max(30500, streamPayload.price),
          low: Math.min(30500, streamPayload.price),
          close: streamPayload.price,
          volume: streamPayload.volume,
          ticksCount: 5,
        },
        metrics: {
          netProfit: 4600,
          netProfitPercent: 4.6,
          grossProfit: 6100,
          grossLoss: 1500,
          profitFactor: 4.07,
          totalTrades: 12,
          winningTrades: 9,
          losingTrades: 3,
          winRate: 75.0,
          maxDrawdown: 400,
          maxDrawdownPercent: 0.4,
          sharpeRatio: 2.15,
          sortinoRatio: 3.3,
          cagr: 29.1,
        },
      };

      for (const l of this.listeners) {
        l({
          data: {
            reqId: cmd.id,
            type: 'STREAM_TICK_RESULT',
            success: true,
            payload: resPayload,
          } satisfies WorkerResponse<StreamTickResultPayload>,
        });
      }
      return;
    }
  }
}

describe('AppController Lifecycle & Integration', () => {
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

  it('initializes workspace, mounts components, and manages backtest workflow', async () => {
    const mockWorker = new MockAppWorker();
    const app = new AppController({
      container: container as unknown as HTMLElement,
      worker: mockWorker,
      barsCount: 50,
    });

    await app.init();

    const workspace = app.getWorkspace();
    expect(workspace).not.toBeNull();
    expect(workspace?.getTopBar().getStatus()).toBe('idle');

    // Trigger backtest
    await app.runBacktest();
    expect(workspace?.getTopBar().getStatus()).toBe('idle');
    expect(mockWorker.messagesPosted.length).toBeGreaterThanOrEqual(1);

    const postCmd = mockWorker.messagesPosted[0].message as WorkerCommand;
    expect(postCmd.type).toBe('RUN_BACKTEST');

    // Streaming toggle
    app.startLiveStreaming();
    expect(workspace?.getTopBar().isStreaming()).toBe(true);

    app.stopLiveStreaming();
    expect(workspace?.getTopBar().isStreaming()).toBe(false);

    app.destroy();
  });
});
