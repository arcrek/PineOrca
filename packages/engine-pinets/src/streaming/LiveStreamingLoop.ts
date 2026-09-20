// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { Context } from '../Context.class';
import { PineContext } from '../core/PineContext';
import { PineEngine } from '../core/PineEngine';
import { stepBar } from '../broker/StrategyKernel';
import {
  takeContextSnapshot,
  restoreContextSnapshot,
  type ContextSnapshot,
} from './StateSnapshot';

export interface Tick {
  price: number;
  volume?: number;
  time?: number;
}

export interface FormingBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ticksCount: number;
}

export interface LiveStreamingOptions {
  /**
   * Batch interval in milliseconds for debounced tick dispatch (default ~16.6ms for 60Hz).
   */
  batchIntervalMs?: number;
  /**
   * Whether to throttle high-frequency ticks to 60Hz via RAF / timer (default false for instant tick-by-tick tests).
   */
  useDebounce?: boolean;
  /**
   * Callback fired on each provisional tick execution.
   */
  onTick?: (context: Context, bar: FormingBar) => void;
  /**
   * Callback fired when a forming bar is officially closed.
   */
  onBarClose?: (context: Context, bar: FormingBar) => void;
  /**
   * Optional error callback.
   */
  onError?: (error: any) => void;
}

/**
 * Real-time Pine Script live streaming engine with provisional bar state rollbacks.
 *
 * Mechanics:
 * - Captures an immutable snapshot of strategy state and context variables at confirmed bar N-1.
 * - When provisional ticks arrive on forming bar N, rolls back to bar N-1 before re-executing bar N,
 *   guaranteeing 0 state drift and 0 leakage of provisional orders into historical ledger.
 * - Supports 60Hz debounced batching to handle 1,000+ ticks/sec without choking the UI or chart.
 * - On confirmed bar close, commits final orders, latches equity peaks, and advances historical window.
 */
export class LiveStreamingLoop {
  public readonly context: Context;
  public readonly transpiledFn: Function;
  public readonly options: LiveStreamingOptions;

  private _confirmedSnapshot: ContextSnapshot | null = null;
  private _confirmedBarIndex: number = -1;
  private _formingBar: FormingBar | null = null;
  private _formingBarIndex: number = -1;
  private _debounceTimer: any = null;
  private _isDestroyed: boolean = false;
  private _ticksProcessed: number = 0;
  private _timeframeDurationMs: number = 60_000;

  constructor(
    context: Context,
    transpiledFn: Function,
    options: LiveStreamingOptions = {},
  ) {
    this.context = context;
    this.transpiledFn = transpiledFn;
    this.options = {
      batchIntervalMs: 16.6,
      useDebounce: false,
      ...options,
    };

    this._timeframeDurationMs = this._resolveTimeframeDuration(context.timeframe);
  }

  /**
   * Initializes the live loop by snapshotting the initial confirmed state.
   * If executeHistory is true, executes historical bars 0..N-1 first.
   */
  public initialize(executeHistory: boolean = false): void {
    if (executeHistory) {
      PineEngine.executeSync(this.context, this.transpiledFn);
    }

    this._confirmedBarIndex = this.context.length > 0 ? this.context.length - 1 : -1;
    this._confirmedSnapshot = takeContextSnapshot(this.context);
    this._formingBar = null;
    this._formingBarIndex = -1;
  }

  public get confirmedBarIndex(): number {
    return this._confirmedBarIndex;
  }

  public get formingBar(): FormingBar | null {
    return this._formingBar ? { ...this._formingBar } : null;
  }

  public get formingBarIndex(): number {
    return this._formingBarIndex;
  }

  public get ticksProcessed(): number {
    return this._ticksProcessed;
  }

  public get confirmedSnapshot(): ContextSnapshot | null {
    return this._confirmedSnapshot;
  }

  /**
   * Pushes a single tick into the forming bar.
   */
  public pushTick(tick: Tick): void {
    if (this._isDestroyed) return;

    const price = tick.price;
    const vol = tick.volume ?? 0;
    const time = tick.time ?? Date.now();

    if (this._formingBar === null) {
      this._formingBarIndex = this._confirmedBarIndex + 1;
      this._formingBar = {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: vol,
        ticksCount: 1,
      };
    } else {
      if (price > this._formingBar.high) this._formingBar.high = price;
      if (price < this._formingBar.low) this._formingBar.low = price;
      this._formingBar.close = price;
      this._formingBar.volume += vol;
      this._formingBar.ticksCount++;
    }

    this._ticksProcessed++;

    if (this.options.useDebounce) {
      this._scheduleDebouncedExecution();
    } else {
      this._executeProvisionalBar(this._formingBar);
    }
  }

  /**
   * Schedules a debounced 60Hz provisional bar execution.
   */
  private _scheduleDebouncedExecution(): void {
    if (this._debounceTimer !== null) return;

    const interval = Math.max(1, Math.round(this.options.batchIntervalMs ?? 16.6));
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      if (this._isDestroyed || !this._formingBar) return;
      this._executeProvisionalBar(this._formingBar);
    }, interval);
  }

  /**
   * Executes forming bar tentatively after rolling back to confirmed state.
   */
  private _executeProvisionalBar(bar: FormingBar): void {
    if (!this._confirmedSnapshot) {
      this._confirmedSnapshot = takeContextSnapshot(this.context);
    }

    try {
      // 1. Rollback context to confirmed state
      restoreContextSnapshot(this.context, this._confirmedSnapshot);

      // 2. Set forming bar values
      this._setBarData(this._formingBarIndex, bar);

      // 3. Set barstate flags for unconfirmed forming bar
      this.context.idx = this._formingBarIndex;
      this.context._execTick = (this.context._execTick || 0) + 1;

      const bs = (this.context.pine as any)?.barstate;
      if (bs) {
        bs.isconfirmedOverride = false;
        bs.isrealtimeOverride = true;
        bs.islastOverride = true;
        bs.ishistoryOverride = false;
        bs.isnewOverride = (bar.ticksCount === 1);
        bs.setLive?.();
      }

      // 4. Broker checkpoint & provisional script execution
      if (this.context.strategy) {
        stepBar(this.context);
      }

      const res = this.transpiledFn(this.context);
      (PineEngine as any).collectResult(this.context, res);

      if (this.context._drawingHelpers) {
        for (let d = 0; d < this.context._drawingHelpers.length; d++) {
          const helper = this.context._drawingHelpers[d];
          if (helper.syncToPlot) helper.syncToPlot();
        }
      }

      // 5. Notify listener
      this.options.onTick?.(this.context, bar);
    } catch (err) {
      if (this.options.onError) {
        this.options.onError(err);
      } else {
        throw err;
      }
    }
  }

  /**
   * Commits the current forming bar as confirmed, advancing the historical window.
   */
  public closeBar(finalBar?: Partial<FormingBar>): FormingBar {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    if (!this._formingBar) {
      throw new Error('Cannot closeBar: no forming bar is currently active');
    }

    if (finalBar) {
      if (finalBar.open !== undefined) this._formingBar.open = finalBar.open;
      if (finalBar.high !== undefined) this._formingBar.high = Math.max(this._formingBar.high, finalBar.high);
      if (finalBar.low !== undefined) this._formingBar.low = Math.min(this._formingBar.low, finalBar.low);
      if (finalBar.close !== undefined) this._formingBar.close = finalBar.close;
      if (finalBar.volume !== undefined) this._formingBar.volume = finalBar.volume;
      if (finalBar.time !== undefined) this._formingBar.time = finalBar.time;
    }

    const closedBar = { ...this._formingBar };
    const barIdx = this._formingBarIndex;

    // 1. Rollback to confirmed snapshot before final execution
    if (this._confirmedSnapshot) {
      restoreContextSnapshot(this.context, this._confirmedSnapshot);
    }

    // 2. Set confirmed bar data
    this._setBarData(barIdx, closedBar);
    this.context.idx = barIdx;
    this.context._execTick = (this.context._execTick || 0) + 1;

    // 3. Mark barstate as confirmed
    const bs = (this.context.pine as any)?.barstate;
    if (bs) {
      bs.isconfirmedOverride = true;
      bs.isrealtimeOverride = false;
      bs.islastOverride = true;
      bs.ishistoryOverride = false;
      bs.isnewOverride = false;
    }

    // 4. Execute final confirmed step
    if (this.context.strategy) {
      stepBar(this.context);
    }

    const res = this.transpiledFn(this.context);
    (PineEngine as any).collectResult(this.context, res);

    if (this.context._drawingHelpers) {
      for (let d = 0; d < this.context._drawingHelpers.length; d++) {
        const helper = this.context._drawingHelpers[d];
        if (helper.syncToPlot) helper.syncToPlot();
      }
    }

    // Shift user series variables for next bar
    PineEngine.shiftVariables(this.context);

    // 5. Advance confirmed baseline
    this._confirmedBarIndex = barIdx;
    this._confirmedSnapshot = takeContextSnapshot(this.context);
    this._formingBar = null;
    this._formingBarIndex = -1;

    // 6. Notify listener
    this.options.onBarClose?.(this.context, closedBar);

    return closedBar;
  }

  /**
   * Synchronously flushes any pending debounced tick execution.
   */
  public flush(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._formingBar) {
      this._executeProvisionalBar(this._formingBar);
    }
  }

  /**
   * Tears down any active timers.
   */
  public dispose(): void {
    this._isDestroyed = true;
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  /**
   * Applies bar data to context. Handles both PineContext (columnar SOA) and generic Context.
   */
  private _setBarData(index: number, bar: FormingBar): void {
    if (this.context instanceof PineContext) {
      this.context.setBarAt(index, bar);
      return;
    }

    // Fallback for generic Context with Series arrays
    const d = this.context.data;
    if (d) {
      if (d.open?.data) d.open.data[index] = bar.open;
      if (d.high?.data) d.high.data[index] = bar.high;
      if (d.low?.data) d.low.data[index] = bar.low;
      if (d.close?.data) d.close.data[index] = bar.close;
      if (d.volume?.data) d.volume.data[index] = bar.volume;
      if (d.openTime?.data) d.openTime.data[index] = bar.time;
      if (d.closeTime?.data) d.closeTime.data[index] = bar.time + this._timeframeDurationMs;
    }

    if (this.context.length <= index) {
      this.context.length = index + 1;
    }
  }

  private _resolveTimeframeDuration(timeframe?: string): number {
    if (!timeframe) return 60_000;
    const tf = timeframe.toUpperCase();
    const map: Record<string, number> = {
      '1': 60_000,
      '1M': 60_000,
      '3': 180_000,
      '5': 300_000,
      '15': 900_000,
      '30': 1_800_000,
      '60': 3_600_000,
      '1H': 3_600_000,
      '1D': 86_400_000,
      'D': 86_400_000,
    };
    return map[tf] ?? 60_000;
  }
}
