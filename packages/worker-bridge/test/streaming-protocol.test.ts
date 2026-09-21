import { describe, it, expect, vi } from 'vitest';
import { WorkerBridge, type WorkerLike } from '../src/WorkerBridge.js';
import type {
  WorkerCommand,
  WorkerResponse,
  StreamTickPayload,
  StreamTickResultPayload,
} from '../src/protocol.js';

class MockStreamingWorker implements WorkerLike {
  public messagesPosted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  private readonly _listeners = new Set<(event: { data: unknown }) => void>();
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
    if (cmd.type === 'STREAM_TICK') {
      const payload = cmd.payload as StreamTickPayload;
      if (payload.price < 0) {
        this.emitFromWorker({
          reqId: cmd.id,
          type: 'ERROR',
          success: false,
          error: {
            code: 'INVALID_PRICE',
            message: 'Price cannot be negative',
          },
        } satisfies WorkerResponse);
        return;
      }

      this.emitFromWorker({
        reqId: cmd.id,
        type: 'STREAM_TICK_RESULT',
        success: true,
        payload: {
          runId: payload.runId,
          bar: {
            time: payload.time,
            open: 100,
            high: Math.max(100, payload.price),
            low: Math.min(100, payload.price),
            close: payload.price,
            volume: payload.volume,
            ticksCount: 1,
            isBarClose: payload.isBarClose ?? false,
          },
          metrics: {
            netProfit: 150,
            netProfitPercent: 1.5,
            grossProfit: 200,
            grossLoss: 50,
            profitFactor: 4.0,
            totalTrades: 2,
            winningTrades: 2,
            losingTrades: 0,
            winRate: 100,
            maxDrawdown: 10,
            maxDrawdownPercent: 0.1,
            sharpeRatio: 2.1,
            sortinoRatio: 2.8,
            cagr: 18.0,
          },
          openTrades: [],
          closedTrades: [],
          equity: 100150,
        } satisfies StreamTickResultPayload,
      } satisfies WorkerResponse<StreamTickResultPayload>);
      return;
    }

    if (cmd.type === 'PING') {
      this.emitFromWorker({
        reqId: cmd.id,
        type: 'PONG',
        success: true,
        payload: { timestamp: Date.now() },
      } satisfies WorkerResponse);
      return;
    }
  }
}

describe('Streaming Protocol & WorkerBridge Tick Pipeline', () => {
  it('dispatches STREAM_TICK command and resolves with StreamTickResultPayload', async () => {
    const mockWorker = new MockStreamingWorker();
    const bridge = new WorkerBridge({ worker: mockWorker, heartbeatIntervalMs: 0 });

    const tickPayload: StreamTickPayload = {
      runId: 'run-stream-1',
      time: 1609459200000,
      price: 105.5,
      volume: 250,
      isBarClose: false,
    };

    const result = await bridge.streamTick(tickPayload);

    expect(result).toBeDefined();
    expect(result.runId).toBe('run-stream-1');
    expect(result.bar.close).toBe(105.5);
    expect(result.bar.volume).toBe(250);
    expect(result.bar.isBarClose).toBe(false);
    expect(result.metrics?.netProfit).toBe(150);
    expect(result.equity).toBe(100150);

    expect(mockWorker.messagesPosted).toHaveLength(1);
    const posted = mockWorker.messagesPosted[0].message as WorkerCommand;
    expect(posted.type).toBe('STREAM_TICK');
    expect(posted.payload).toEqual(tickPayload);

    bridge.destroy();
  });

  it('notifies onTickResult listeners on incoming stream tick results and unregisters properly', async () => {
    const mockWorker = new MockStreamingWorker();
    const bridge = new WorkerBridge({ worker: mockWorker, heartbeatIntervalMs: 0 });

    const received: StreamTickResultPayload[] = [];
    const unsubscribe = bridge.onTickResult('run-stream-2', (res) => {
      received.push(res);
    });

    await bridge.streamTick({
      runId: 'run-stream-2',
      time: 1609459260000,
      price: 110,
      volume: 100,
    });

    expect(received).toHaveLength(1);
    expect(received[0].runId).toBe('run-stream-2');
    expect(received[0].bar.close).toBe(110);

    // Unsubscribe and verify no more events trigger
    unsubscribe();

    await bridge.streamTick({
      runId: 'run-stream-2',
      time: 1609459320000,
      price: 112,
      volume: 300,
    });

    expect(received).toHaveLength(1);

    bridge.destroy();
  });

  it('rejects with descriptive error when worker returns error for STREAM_TICK', async () => {
    const mockWorker = new MockStreamingWorker();
    const bridge = new WorkerBridge({ worker: mockWorker, heartbeatIntervalMs: 0 });

    await expect(
      bridge.streamTick({
        runId: 'run-err',
        time: 1609459200000,
        price: -50,
        volume: 10,
      }),
    ).rejects.toThrow('Price cannot be negative');

    bridge.destroy();
  });
});
