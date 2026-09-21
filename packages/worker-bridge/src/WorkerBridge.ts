import type { ColumnarBarTable, ColumnarBufferPayload } from '@pineorca/data';
import type {
  BacktestResultPayload,
  CancelRunPayload,
  CommandType,
  GetSeriesSlicePayload,
  PingPayload,
  ProgressPayload,
  RunBacktestPayload,
  StreamTickPayload,
  StreamTickResultPayload,
  WorkerCommand,
  WorkerResponse,
} from './protocol.js';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
}

export interface WorkerBridgeOptions {
  /** Existing Worker instance */
  worker?: WorkerLike;
  /** Factory to spawn a new Worker */
  workerFactory?: () => WorkerLike;
  /** Default command timeout in milliseconds (default: 30,000) */
  timeoutMs?: number;
  /** Heartbeat interval in milliseconds (0 disables, default: 5,000) */
  heartbeatIntervalMs?: number;
  /** Heartbeat response timeout in milliseconds (default: 2,000) */
  heartbeatTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutTimer: NodeJS.Timeout | number;
  type: CommandType;
}

/**
 * Main-thread typed RPC client managing Worker lifecycle, request-response multiplexing,
 * zero-copy Transferable buffer transfers, and health-check heartbeats.
 */
export class WorkerBridge {
  public static readonly DEFAULT_TIMEOUT_MS = 30_000;
  public static readonly DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
  public static readonly DEFAULT_HEARTBEAT_TIMEOUT_MS = 2_000;

  private _worker: WorkerLike | null = null;
  private readonly _workerFactory?: () => WorkerLike;
  private readonly _timeoutMs: number;
  private readonly _heartbeatIntervalMs: number;
  private readonly _heartbeatTimeoutMs: number;

  private _reqSeq = 0;
  private readonly _pending = new Map<string, PendingRequest>();
  private readonly _progressListeners = new Map<string, Set<(progress: ProgressPayload) => void>>();
  private readonly _tickResultListeners = new Map<
    string,
    Set<(res: StreamTickResultPayload) => void>
  >();
  private _heartbeatTimer: NodeJS.Timeout | number | null = null;
  private _isHealthy = false;
  private _isDestroyed = false;

  private readonly _messageHandler = (event: { data: unknown }): void => {
    this._handleWorkerMessage(event.data);
  };

  constructor(options: WorkerBridgeOptions = {}) {
    this._workerFactory = options.workerFactory;
    this._timeoutMs = options.timeoutMs ?? WorkerBridge.DEFAULT_TIMEOUT_MS;
    this._heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? WorkerBridge.DEFAULT_HEARTBEAT_INTERVAL_MS;
    this._heartbeatTimeoutMs =
      options.heartbeatTimeoutMs ?? WorkerBridge.DEFAULT_HEARTBEAT_TIMEOUT_MS;

    if (options.worker) {
      this.attachWorker(options.worker);
    }
  }

  public get isHealthy(): boolean {
    return this._isHealthy;
  }

  public get isConnected(): boolean {
    return this._worker !== null && !this._isDestroyed;
  }

  /**
   * Attaches or switches to a new Worker instance.
   */
  public attachWorker(worker: WorkerLike): void {
    if (this._worker) {
      this._worker.removeEventListener('message', this._messageHandler);
    }
    this._worker = worker;
    this._worker.addEventListener('message', this._messageHandler);
    this._isHealthy = true;
    this._startHeartbeat();
  }

  /**
   * Spawns worker using the configured factory if not already active.
   */
  public start(): void {
    if (!this._worker && this._workerFactory) {
      this.attachWorker(this._workerFactory());
    }
  }

  /**
   * Executes a Pine backtest script against transferred columnar market data.
   * Transferred ArrayBuffers are zero-copy moved to the worker thread (<2ms).
   */
  public async runBacktest(
    payload:
      | RunBacktestPayload
      | (Omit<RunBacktestPayload, 'bars'> & {
          bars: ColumnarBarTable | ColumnarBufferPayload;
          transferOwnership?: boolean;
        }),
    onProgress?: (progress: ProgressPayload) => void,
  ): Promise<BacktestResultPayload> {
    let wireBars: ColumnarBufferPayload;
    let transferables: Transferable[] = [];
    const barsInput = payload.bars;

    if ('isDetached' in barsInput && barsInput.isDetached) {
      throw new Error('Cannot transfer an already detached ColumnarBarTable');
    }

    const transferOwnership =
      'transferOwnership' in payload ? !!payload.transferOwnership : true;

    if ('stride' in barsInput && 'buffer' in barsInput) {
      wireBars = barsInput;
      if (wireBars.buffer && transferOwnership) {
        transferables = [wireBars.buffer];
      }
    } else {
      const sourceTable = transferOwnership ? barsInput : barsInput.clone();
      wireBars = sourceTable.toPayload();
      transferables = sourceTable.transferables;
    }
    const wirePayload: RunBacktestPayload = {
      runId: payload.runId,
      source: payload.source,
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      bars: wireBars,
      params: payload.params,
      inputs: payload.inputs,
    };

    if (onProgress) {
      let listeners = this._progressListeners.get(payload.runId);
      if (!listeners) {
        listeners = new Set();
        this._progressListeners.set(payload.runId, listeners);
      }
      listeners.add(onProgress);
    }

    try {
      const result = await this.send<RunBacktestPayload, BacktestResultPayload>(
        'RUN_BACKTEST',
        wirePayload,
        transferables,
      );
      return result;
    } finally {
      if (onProgress) {
        this._progressListeners.delete(payload.runId);
      }
    }
  }

  /**
   * Sends real-time tick to the worker for incremental state evaluation.
   */
  public async streamTick(
    payload: StreamTickPayload,
  ): Promise<StreamTickResultPayload> {
    return this.send<StreamTickPayload, StreamTickResultPayload>(
      'STREAM_TICK',
      payload,
    );
  }

  /**
   * Registers a listener for real-time tick execution results for a specific runId.
   * Returns an unsubscribe function.
   */
  public onTickResult(
    runId: string,
    cb: (res: StreamTickResultPayload) => void,
  ): () => void {
    let listeners = this._tickResultListeners.get(runId);
    if (!listeners) {
      listeners = new Set();
      this._tickResultListeners.set(runId, listeners);
    }
    listeners.add(cb);
    return () => {
      const set = this._tickResultListeners.get(runId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) {
          this._tickResultListeners.delete(runId);
        }
      }
    };
  }

  /**
   * Cancels an ongoing backtest execution.
   */
  public async cancelRun(runId: string): Promise<boolean> {
    const res = await this.send<CancelRunPayload, { success: boolean }>('CANCEL_RUN', { runId });
    this._progressListeners.delete(runId);
    return res.success;
  }

  /**
   * Queries calculated series slices from the worker memory.
   */
  public async getSeriesSlice(payload: GetSeriesSlicePayload): Promise<unknown> {
    return this.send<GetSeriesSlicePayload, unknown>('GET_SERIES_SLICE', payload);
  }

  /**
   * Sends health-check ping to the worker, resolving with round-trip latency in ms.
   */
  public async ping(): Promise<number> {
    const start = Date.now();
    await this.send<PingPayload, unknown>(
      'PING',
      { timestamp: start },
      [],
      this._heartbeatTimeoutMs,
    );
    return Date.now() - start;
  }

  /**
   * Low-level typed RPC message sender.
   */
  public send<TPayload, TResult>(
    type: CommandType,
    payload: TPayload,
    transferList: Transferable[] = [],
    timeoutMs: number = this._timeoutMs,
  ): Promise<TResult> {
    if (!this._worker) {
      if (this._workerFactory) {
        this.start();
      } else {
        return Promise.reject(new Error('WorkerBridge has no active Worker attached'));
      }
    }

    const worker = this._worker!;
    const reqId = `req_${++this._reqSeq}_${Date.now()}`;

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(reqId);
        reject(
          new Error(
            `WorkerBridge request timed out after ${timeoutMs}ms (type=${type}, reqId=${reqId})`,
          ),
        );
      }, timeoutMs);

      this._pending.set(reqId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutTimer: timer,
        type,
      });

      const command: WorkerCommand<TPayload> = {
        id: reqId,
        type,
        payload,
      };

      try {
        if (transferList.length > 0) {
          worker.postMessage(command, transferList);
        } else {
          worker.postMessage(command);
        }
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(reqId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Incoming message dispatcher from the Worker.
   */
  private _handleWorkerMessage(data: unknown): void {
    if (!data || typeof data !== 'object') {
      return;
    }

    const response = data as WorkerResponse;

    if (response.type === 'STREAM_TICK_RESULT') {
      const tickRes = response.payload as StreamTickResultPayload | undefined;
      if (tickRes && tickRes.runId) {
        const listeners = this._tickResultListeners.get(tickRes.runId);
        if (listeners) {
          for (const listener of listeners) {
            listener(tickRes);
          }
        }
      }
    }

    // Handle streaming progress messages without completing the pending request
    if (response.type === 'PROGRESS') {
      const progress = response.payload as ProgressPayload | undefined;
      if (progress && progress.runId) {
        const listeners = this._progressListeners.get(progress.runId);
        if (listeners) {
          for (const listener of listeners) {
            listener(progress);
          }
        }
      }
      return;
    }

    const reqId = response.reqId;
    if (!reqId) {
      return;
    }

    const pending = this._pending.get(reqId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutTimer);
    this._pending.delete(reqId);

    if (response.success) {
      pending.resolve(response.payload);
    } else {
      const errorPayload = response.error;
      const error = new Error(
        errorPayload?.message ?? `Worker command failed with type ${response.type}`,
      );
      if (errorPayload?.stack) {
        error.stack = errorPayload.stack;
      }
      pending.reject(error);
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    if (this._heartbeatIntervalMs <= 0) {
      return;
    }

    this._heartbeatTimer = setInterval(async () => {
      if (!this._worker || this._isDestroyed) {
        return;
      }
      try {
        await this.ping();
        this._isHealthy = true;
      } catch {
        this._isHealthy = false;
      }
    }, this._heartbeatIntervalMs);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Terminates worker and cancels all pending requests.
   */
  public terminate(): void {
    this._isDestroyed = true;
    this._stopHeartbeat();
    this._tickResultListeners.clear();

    for (const [reqId, pending] of this._pending.entries()) {
      clearTimeout(pending.timeoutTimer);
      pending.reject(new Error(`WorkerBridge terminated while request ${reqId} was pending`));
    }
    this._pending.clear();
    this._progressListeners.clear();

    if (this._worker) {
      this._worker.removeEventListener('message', this._messageHandler);
      if (typeof this._worker.terminate === 'function') {
        this._worker.terminate();
      }
      this._worker = null;
    }
    this._isHealthy = false;
  }

  public destroy(): void {
    this.terminate();
  }
}
