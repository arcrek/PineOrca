import type { ColumnarBufferPayload } from '@pineorca/data';

/**
 * Supported command types sent from main thread to the Pine Worker.
 */
export type CommandType =
  | 'RUN_BACKTEST'
  | 'STREAM_TICK'
  | 'CANCEL_RUN'
  | 'GET_SERIES_SLICE'
  | 'PING';

/**
 * Supported response types emitted from the Pine Worker to the main thread.
 */
export type ResponseType =
  | 'RUN_BACKTEST_RESULT'
  | 'STREAM_TICK_RESULT'
  | 'CANCEL_RUN_RESULT'
  | 'SERIES_SLICE_RESULT'
  | 'PROGRESS'
  | 'PONG'
  | 'ERROR';

/**
 * Strategy backtesting execution parameters.
 */
export interface BacktestParams {
  initialCapital?: number;
  currency?: string;
  commission?: number;
  commissionType?: 'percent' | 'cash_per_contract' | 'cash_per_order';
  slippage?: number;
  marginLong?: number;
  marginShort?: number;
  pyramiding?: number;
  calcOnOrderFills?: boolean;
  calcOnEveryTick?: boolean;
  precision?: number;
}

export interface RunBacktestPayload {
  runId: string;
  source: string;
  symbol: string;
  timeframe: string;
  bars: ColumnarBufferPayload;
  params?: BacktestParams;
  inputs?: Record<string, unknown>;
}

export interface StreamTickPayload {
  runId: string;
  time: number;
  price: number;
  volume: number;
  isBarClose?: boolean;
}

export interface CancelRunPayload {
  runId: string;
}

export interface GetSeriesSlicePayload {
  runId: string;
  seriesId: string;
  startBar: number;
  endBar: number;
}

export interface PingPayload {
  timestamp: number;
}

/**
 * Main-thread to Worker command envelope.
 */
export interface WorkerCommand<T = unknown> {
  id: string;
  type: CommandType;
  payload: T;
}

/**
 * Standard performance metrics output from backtesting.
 */
export interface PerformanceMetrics {
  netProfit: number;
  netProfitPercent: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  cagr: number;
}

export interface BacktestResultPayload {
  runId: string;
  metrics: PerformanceMetrics;
  trades: unknown[];
  equityCurve: Float64Array | number[];
  drawdownCurve: Float64Array | number[];
  durationMs: number;
}

export interface ProgressPayload {
  runId: string;
  currentBar: number;
  totalBars: number;
  percent: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  stack?: string;
  line?: number;
  column?: number;
}

/**
 * Worker to main-thread response envelope.
 */
export interface WorkerResponse<T = unknown> {
  reqId: string;
  type: ResponseType;
  success: boolean;
  payload?: T;
  error?: ErrorPayload;
}
