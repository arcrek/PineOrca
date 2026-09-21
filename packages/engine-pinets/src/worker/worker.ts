// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { ColumnarBarTable } from '@pineorca/data';
import type {
  WorkerCommand,
  WorkerResponse,
  RunBacktestPayload,
  BacktestResultPayload,
  ProgressPayload,
  PerformanceMetrics,
  StreamTickPayload,
  StreamTickResultPayload,
  CancelRunPayload,
  PingPayload,
} from '@pineorca/worker-bridge';
import { PineTranspiler } from '../transpiler/PineTranspiler';
import { PineContext } from '../core/PineContext';
import { PineEngine } from '../core/PineEngine';
import { LiveStreamingLoop } from '../streaming/LiveStreamingLoop';

export type WorkerResponseSender = (msg: WorkerResponse<any>) => void;

// Active run state for cancellation tracking and live streaming continuity
const activeRuns = new Map<
  string,
  {
    cancelled: boolean;
    context?: PineContext;
    compiledFn?: Function;
    initialCapital?: number;
  }
>();

export const activeStreamingLoops = new Map<string, LiveStreamingLoop>();

/**
 * Dispatches an RPC response envelope to the host thread.
 */
function emitResponse<T>(
  post: (msg: WorkerResponse<T>) => void,
  reqId: string,
  type: WorkerResponse['type'],
  success: boolean,
  payload?: T,
  error?: { code: string; message: string; stack?: string },
): void {
  post({
    reqId,
    type,
    success,
    payload,
    error,
  });
}

/**
 * Calculates standardized PerformanceMetrics from the strategy execution state.
 */
function calculateMetrics(
  strategy: any,
  initialCapital: number = 100000,
  equityCurve: Float64Array,
): PerformanceMetrics {
  if (!strategy || !strategy.closedtrades) {
    return {
      netProfit: 0,
      netProfitPercent: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      cagr: 0,
    };
  }

  const closedTrades: any[] = strategy.closedtrades;
  const totalTrades = closedTrades.length;
  let grossProfit = 0;
  let grossLoss = 0;
  let winningTrades = 0;
  let losingTrades = 0;

  for (let i = 0; i < totalTrades; i++) {
    const pnl = closedTrades[i].profit ?? 0;
    if (pnl > 0) {
      grossProfit += pnl;
      winningTrades++;
    } else if (pnl < 0) {
      grossLoss += Math.abs(pnl);
      losingTrades++;
    }
  }

  const netProfit = grossProfit - grossLoss;
  const netProfitPercent = initialCapital > 0 ? (netProfit / initialCapital) * 100 : 0;
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 999.0 : 0) : grossProfit / grossLoss;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  // Max drawdown from equity curve
  let peak = initialCapital;
  let maxDD = 0;
  let maxDDPercent = 0;

  for (let i = 0; i < equityCurve.length; i++) {
    const eq = equityCurve[i];
    if (eq > peak) {
      peak = eq;
    }
    const dd = peak - eq;
    if (dd > maxDD) {
      maxDD = dd;
    }
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddPct > maxDDPercent) {
      maxDDPercent = ddPct;
    }
  }

  return {
    netProfit,
    netProfitPercent,
    grossProfit,
    grossLoss,
    profitFactor,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    maxDrawdown: maxDD,
    maxDrawdownPercent: maxDDPercent,
    sharpeRatio: strategy.sharpe_ratio ?? 0,
    sortinoRatio: strategy.sortino_ratio ?? 0,
    cagr: strategy.cagr ?? 0,
  };
}

/**
 * Processes incoming worker commands.
 * Exposed directly for testing and host embedding.
 */
export async function handleWorkerCommand(
  cmd: WorkerCommand,
  postMessageFn: (msg: WorkerResponse<any>) => void,
): Promise<void> {
  const { id: reqId, type, payload } = cmd;

  switch (type) {
    case 'PING': {
      const pingPayload = payload as PingPayload;
      emitResponse(postMessageFn, reqId, 'PONG', true, {
        timestamp: pingPayload?.timestamp ?? Date.now(),
      });
      break;
    }

    case 'CANCEL_RUN': {
      const cancelPayload = payload as CancelRunPayload;
      const runId = cancelPayload.runId;
      const run = activeRuns.get(runId);
      if (run) {
        run.cancelled = true;
      }
      activeRuns.delete(runId);
      const loop = activeStreamingLoops.get(runId);
      if (loop) {
        loop.destroy();
        activeStreamingLoops.delete(runId);
      }
      emitResponse(postMessageFn, reqId, 'CANCEL_RUN_RESULT', true, { runId });
      break;
    }

    case 'STREAM_TICK': {
      const streamPayload = payload as StreamTickPayload;
      await handleStreamTickCommand(streamPayload, postMessageFn, reqId);
      break;
    }

    case 'RUN_BACKTEST': {
      const runPayload = payload as RunBacktestPayload;
      const { runId, source, bars: bufferPayload, params, inputs } = runPayload;

      const runState: {
        cancelled: boolean;
        context?: PineContext;
        compiledFn?: Function;
        initialCapital?: number;
      } = { cancelled: false };
      activeRuns.set(runId, runState);

      const startTime = performance.now();

      try {
        // 1. Zero-copy reconstitution of continuous columnar buffer
        const table = ColumnarBarTable.fromPayload(bufferPayload);
        // 2. Transpilation
        const compiled = PineTranspiler.transpile(source, {
          sync: true,
          preResolveSecurity: true,
        });

        // 3. Execution Context setup
        const context = new PineContext({
          table,
          tickerId: runPayload.symbol,
          timeframe: runPayload.timeframe,
          inputs: inputs as any,
        });
        const initialCap = params?.initialCapital ?? 100000;
        runState.context = context;
        runState.compiledFn = compiled.fn;
        runState.initialCapital = initialCap;

        // Setup strategy state if needed
        if (compiled.metadata.isStrategy || source.includes('strategy(')) {
          if (!context.strategy) {
            context.strategy = {
              initial_capital: initialCap,
              currency: params?.currency ?? 'USD',
              margin_long: params?.marginLong ?? 100,
              margin_short: params?.marginShort ?? 100,
              pyramiding: params?.pyramiding ?? 1,
              opentrades: [],
              closedtrades: [],
              pending_orders: [],
              current_equity: initialCap,
              equity_curve: [],
              cash: initialCap,
            } as any;
          }
        }

        // 4. Run synchronous bar execution loop
        const progressInterval = Math.max(1, Math.min(1000, Math.floor(table.length / 10)));
        const onProgress = (currentBar: number, totalBars: number) => {
          const percent = (currentBar / totalBars) * 100;
          emitResponse<ProgressPayload>(postMessageFn, reqId, 'PROGRESS', true, {
            runId,
            currentBar,
            totalBars,
            percent,
          });
        };

        if (compiled.isSync) {
          PineEngine.executeSync(context, compiled.fn, {
            progressInterval,
            onProgress,
            isCancelled: () => runState.cancelled,
          });
        } else {
          await PineEngine.executeAsync(context, compiled.fn, {
            progressInterval,
            onProgress,
            isCancelled: () => runState.cancelled,
          });
        }

        if (runState.cancelled) {
          emitResponse(postMessageFn, reqId, 'ERROR', false, undefined, {
            code: 'RUN_CANCELLED',
            message: `Backtest run ${runId} was cancelled by user`,
          });
          activeRuns.delete(runId);
          return;
        }

        const durationMs = performance.now() - startTime;

        // 5. Package results
        const N = table.length;
        const equityCurve = new Float64Array(N);
        const drawdownCurve = new Float64Array(N);

        let peakEquity = initialCap;
        for (let i = 0; i < N; i++) {
          const eq = (context.strategy as any)?.equity_curve?.[i] ?? initialCap;
          equityCurve[i] = eq;
          if (eq > peakEquity) peakEquity = eq;
          drawdownCurve[i] = peakEquity - eq;
        }

        const metrics = calculateMetrics(context.strategy, initialCap, equityCurve);
        const trades = context.strategy?.closedtrades ?? [];

        const resultPayload: BacktestResultPayload = {
          runId,
          metrics,
          trades,
          equityCurve,
          drawdownCurve,
          durationMs,
        };

        emitResponse<BacktestResultPayload>(
          postMessageFn,
          reqId,
          'RUN_BACKTEST_RESULT',
          true,
          resultPayload,
        );
      } catch (err: any) {
        activeRuns.delete(runId);
        emitResponse(postMessageFn, reqId, 'ERROR', false, undefined, {
          code: 'BACKTEST_EXECUTION_FAILED',
          message: err?.message ?? String(err),
          stack: err?.stack,
        });
      } finally {
        if (runState.cancelled) {
          activeRuns.delete(runId);
        }
      }
      break;
    }

    default: {
      emitResponse(postMessageFn, reqId, 'ERROR', false, undefined, {
        code: 'UNSUPPORTED_COMMAND',
        message: `Unknown or unhandled command type: ${type}`,
      });
      break;
    }
  }
}

/**
 * Handles STREAM_TICK command executing ticks against a live streaming loop.
 */
export async function handleStreamTickCommand(
  payload: StreamTickPayload,
  postMessageFn: WorkerResponseSender,
  reqId: string = '',
): Promise<void> {
  const { runId, time, price, volume, isBarClose } = payload;
  try {
    let loop = activeStreamingLoops.get(runId);
    if (!loop) {
      const run = activeRuns.get(runId);
      if (!run || !run.context || !run.compiledFn) {
        throw new Error(
          `Cannot stream tick: No active backtest context found for runId "${runId}". Run a backtest first.`,
        );
      }
      loop = new LiveStreamingLoop(run.context, run.compiledFn, { useDebounce: false });
      loop.initialize(false);
      activeStreamingLoops.set(runId, loop);
    }

    loop.pushTick({ price, volume, time });

    let bar: any;
    if (isBarClose) {
      const closed = loop.closeBar();
      bar = { ...closed, isBarClose: true };
    } else {
      bar = { ...loop.formingBar, isBarClose: false };
    }

    const initialCap = activeRuns.get(runId)?.initialCapital ?? 100000;
    const currentEquity = (loop.context.strategy as any)?.current_equity ?? initialCap;
    const equityCurve = (loop.context.strategy as any)?.equity_curve
      ? Float64Array.from((loop.context.strategy as any).equity_curve)
      : new Float64Array([currentEquity]);
    const metrics = calculateMetrics(loop.context.strategy, initialCap, equityCurve);
    const openTrades = (loop.context.strategy as any)?.opentrades ?? [];
    const closedTrades = (loop.context.strategy as any)?.closedtrades ?? [];

    const resultPayload: StreamTickResultPayload = {
      runId,
      bar,
      metrics,
      openTrades,
      closedTrades,
      equity: currentEquity,
    };

    emitResponse<StreamTickResultPayload>(
      postMessageFn,
      reqId,
      'STREAM_TICK_RESULT',
      true,
      resultPayload,
    );
  } catch (err: any) {
    emitResponse(postMessageFn, reqId, 'ERROR', false, undefined, {
      code: 'STREAM_TICK_FAILED',
      message: err?.message ?? String(err),
      stack: err?.stack,
    });
  }
}

// Attach to standard Web Worker global message channel if running in worker scope
const workerScope: any = typeof self !== 'undefined' ? self : globalThis;
if (typeof workerScope.postMessage === 'function' && typeof workerScope.addEventListener === 'function') {
  workerScope.addEventListener('message', (event: MessageEvent) => {
    if (event.data && event.data.type) {
      handleWorkerCommand(event.data, (res) => workerScope.postMessage(res));
    }
  });
}
