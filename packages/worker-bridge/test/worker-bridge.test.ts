import { describe, it, expect, vi } from 'vitest';
import { WorkerBridge, type WorkerLike } from '../src/WorkerBridge.js';
import type {
  WorkerCommand,
  WorkerResponse,
  RunBacktestPayload,
  ProgressPayload,
  BacktestResultPayload,
} from '../src/protocol.js';
import { ColumnarBarTable } from '@pineorca/data';

class MockWorker implements WorkerLike {
  public messagesPosted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  private readonly _listeners = new Set<(event: { data: unknown }) => void>();
  public isTerminated = false;

  public postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messagesPosted.push({ message, transfer });

    const cmd = message as WorkerCommand;
    if (!cmd || !cmd.id) return;

    // Simulate async worker processing
    queueMicrotask(() => {
      if (this.isTerminated) return;
      this.handleCommand(cmd);
    });
  }

  public addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void {
    if (type === 'message') {
      this._listeners.add(listener);
    }
  }

  public removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void {
    if (type === 'message') {
      this._listeners.delete(listener);
    }
  }

  public terminate(): void {
    this.isTerminated = true;
    this._listeners.clear();
  }

  public emitFromWorker(data: unknown): void {
    for (const listener of this._listeners) {
      listener({ data });
    }
  }

  private handleCommand(cmd: WorkerCommand): void {
    if (cmd.type === 'PING') {
      this.emitFromWorker({
        reqId: cmd.id,
        type: 'PONG',
        success: true,
        payload: { timestamp: Date.now() },
      } satisfies WorkerResponse);
      return;
    }

    if (cmd.type === 'RUN_BACKTEST') {
      const payload = cmd.payload as RunBacktestPayload;
      // Emit progress
      this.emitFromWorker({
        reqId: cmd.id,
        type: 'PROGRESS',
        success: true,
        payload: {
          runId: payload.runId,
          currentBar: 50,
          totalBars: 100,
          percent: 50,
        } satisfies ProgressPayload,
      } satisfies WorkerResponse);

      // Emit complete result
      this.emitFromWorker({
        reqId: cmd.id,
        type: 'RUN_BACKTEST_RESULT',
        success: true,
        payload: {
          runId: payload.runId,
          metrics: {
            netProfit: 1250.5,
            netProfitPercent: 12.5,
            grossProfit: 2000,
            grossLoss: 749.5,
            profitFactor: 2.67,
            totalTrades: 15,
            winningTrades: 10,
            losingTrades: 5,
            winRate: 66.67,
            maxDrawdown: 350.0,
            maxDrawdownPercent: 3.5,
            sharpeRatio: 1.85,
            sortinoRatio: 2.45,
            cagr: 24.5,
          },
          trades: [],
          equityCurve: [10000, 10500, 11250.5],
          drawdownCurve: [0, 0, 0],
          durationMs: 12,
        } satisfies BacktestResultPayload,
      } satisfies WorkerResponse);
      return;
    }

    if (cmd.type === 'CANCEL_RUN') {
      this.emitFromWorker({
        reqId: cmd.id,
        type: 'CANCEL_RUN_RESULT',
        success: true,
        payload: { success: true },
      } satisfies WorkerResponse);
      return;
    }

    // Default echo success
    this.emitFromWorker({
      reqId: cmd.id,
      type: 'STREAM_TICK_RESULT',
      success: true,
      payload: { processed: true },
    } satisfies WorkerResponse);
  }
}

describe('WorkerBridge: Main-Thread Typed RPC Client', () => {
  it('transfers ColumnarBarTable zero-copy and receives backtest results & progress', async () => {
    const mockWorker = new MockWorker();
    const bridge = new WorkerBridge({
      worker: mockWorker,
      heartbeatIntervalMs: 0, // Disable automatic heartbeat during this test
    });

    const table = ColumnarBarTable.allocate(100);
    for (let i = 0; i < 100; i++) {
      table.time[i] = 1700000000000 + i * 60000;
      table.close[i] = 100 + i;
    }

    const progressUpdates: ProgressPayload[] = [];
    const result = await bridge.runBacktest(
      {
        runId: 'run-123',
        source: '//@version=5\nstrategy("Test")',
        symbol: 'BTCUSDT',
        timeframe: '1m',
        bars: table,
      },
      (p) => progressUpdates.push(p),
    );

    // Verify transferables were passed to postMessage
    expect(mockWorker.messagesPosted.length).toBe(1);
    const postCall = mockWorker.messagesPosted[0];
    expect(postCall.transfer).toBeDefined();
    expect(postCall.transfer!.length).toBe(1);
    expect(postCall.transfer![0]).toBe(table.toPayload().buffer);

    // Verify progress callback
    expect(progressUpdates.length).toBe(1);
    expect(progressUpdates[0].percent).toBe(50);

    // Verify result payload
    expect(result.runId).toBe('run-123');
    expect(result.metrics.netProfit).toBe(1250.5);
    expect(result.metrics.profitFactor).toBe(2.67);
    expect(result.metrics.totalTrades).toBe(15);
  });

  it('preserves caller table when transferOwnership is false', async () => {
    const mockWorker = new MockWorker();
    const bridge = new WorkerBridge({
      worker: mockWorker,
      heartbeatIntervalMs: 0,
    });

    const table = ColumnarBarTable.allocate(50);
    const originalBuffer = table.toPayload().buffer;

    await bridge.runBacktest({
      runId: 'run-safe',
      source: '//@version=5\nstrategy("Safe")',
      symbol: 'ETHUSDT',
      timeframe: '5m',
      bars: table,
      transferOwnership: false,
    });

    // Caller table is NOT detached
    expect(table.isDetached).toBe(false);
    expect(table.length).toBe(50);
    // Transferred buffer was an isolated clone, not the original buffer
    const postCall = mockWorker.messagesPosted[0];
    expect(postCall.transfer![0]).not.toBe(originalBuffer);
  });

  it('measures round-trip ping latency', async () => {
    const mockWorker = new MockWorker();
    const bridge = new WorkerBridge({
      worker: mockWorker,
      heartbeatIntervalMs: 0,
    });

    const latency = await bridge.ping();
    expect(latency).toBeGreaterThanOrEqual(0);
    expect(bridge.isHealthy).toBe(true);
  });

  it('handles worker error responses properly', async () => {
    const mockWorker = new MockWorker();
    const bridge = new WorkerBridge({
      worker: mockWorker,
      heartbeatIntervalMs: 0,
    });

    // Worker emits error response
    const promise = bridge.send('STREAM_TICK', { test: true });
    const reqId = (mockWorker.messagesPosted[0].message as WorkerCommand).id;

    mockWorker.emitFromWorker({
      reqId,
      type: 'ERROR',
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: 'Syntax error in Pine script at line 14',
      },
    } satisfies WorkerResponse);

    await expect(promise).rejects.toThrow('Syntax error in Pine script at line 14');
  });

  it('times out when worker fails to respond within timeoutMs', async () => {
    const mockWorker = new MockWorker();
    // Intercept and do not respond to this command
    mockWorker.postMessage = (message, transfer) => {
      mockWorker.messagesPosted.push({ message, transfer });
    };

    const bridge = new WorkerBridge({
      worker: mockWorker,
      timeoutMs: 50,
      heartbeatIntervalMs: 0,
    });

    await expect(bridge.send('PING', {})).rejects.toThrow(/timed out/);
  });

  it('cancels pending requests on terminate', async () => {
    const mockWorker = new MockWorker();
    mockWorker.postMessage = (message, transfer) => {
      mockWorker.messagesPosted.push({ message, transfer });
    };

    const bridge = new WorkerBridge({
      worker: mockWorker,
      timeoutMs: 5000,
      heartbeatIntervalMs: 0,
    });

    const pending = bridge.send('PING', {});
    bridge.terminate();

    await expect(pending).rejects.toThrow(/terminated while request/);
    expect(mockWorker.isTerminated).toBe(true);
  });
});
