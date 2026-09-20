// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { ColumnarBarTable } from '@pineorca/data';
import { Context } from '../Context.class';
import { FastSeries } from './FastSeries';

export interface PineContextOptions {
  table?: ColumnarBarTable;
  tickerId?: string;
  timeframe?: string;
  inputs?: Record<string, any>;
  strategy?: any;
  chartTimezone?: string;
}

function getTimeframeDurationMs(timeframe?: string): number {
  if (!timeframe) return 60_000;
  const upper = timeframe.toUpperCase();
  const map: Record<string, number> = {
    '1': 60_000, '1M': 60_000, '3': 180_000, '5': 300_000, '15': 900_000, '30': 1_800_000,
    '60': 3_600_000, '1H': 3_600_000, '120': 7_200_000, '2H': 7_200_000,
    '180': 10_800_000, '3H': 10_800_000, '240': 14_400_000, '4H': 14_400_000,
    '1D': 86_400_000, 'D': 86_400_000, '1W': 604_800_000, 'W': 604_800_000,
    '1MO': 30 * 86_400_000, 'M': 30 * 86_400_000,
  };
  return map[upper] ?? 60_000;
}

/**
 * High-performance Pine Script Execution Context.
 * Binds market data directly to zero-copy Float64Array columnar buffers via FastSeries,
 * completely eliminating boxed JS object-array allocations and GC churn.
 */
export class PineContext extends Context {
  public table?: ColumnarBarTable;
  public readonly _securitySeries: Map<string, FastSeries> = new Map();

  constructor(options: PineContextOptions = {}) {
    super({
      marketData: (options.table as any) ?? [],
      source: (options.table as any) ?? [],
      timeframe: options.timeframe ?? '1D',
      inputs: options.inputs ?? {},
    });

    if (options.chartTimezone) {
      this.chartTimezone = options.chartTimezone;
    }

    if (options.table) {
      this.bindTable(options.table);
    }
  }

  /**
   * Binds context built-in series directly to the ColumnarBarTable's Float64Array buffers.
   */
  public bindTable(table: ColumnarBarTable): void {
    this.table = table;
    this.length = table.length;

    const tfDuration = getTimeframeDurationMs(this.timeframe);
    const N = table.length;

    // Zero-copy Proxy for marketData to satisfy legacy context.marketData[idx].openTime
    this.marketData = new Proxy(table, {
      get(target: ColumnarBarTable, prop: string | symbol) {
        if (typeof prop === 'string') {
          const idx = Number(prop);
          if (!Number.isNaN(idx)) {
            if (idx < 0 || idx >= target.length) return undefined;
            const openTime = target.time[idx];
            const closeTime = idx + 1 < target.length ? target.time[idx + 1] : openTime + tfDuration;
            return {
              openTime,
              closeTime,
              open: target.open[idx],
              high: target.high[idx],
              low: target.low[idx],
              close: target.close[idx],
              volume: target.volume[idx],
            };
          }
        }
        return (target as any)[prop];
      },
    });
    this.data.open = new FastSeries(table.open, this);
    this.data.high = new FastSeries(table.high, this);
    this.data.low = new FastSeries(table.low, this);
    this.data.close = new FastSeries(table.close, this);
    this.data.volume = new FastSeries(table.volume, this);
    this.data.time = new FastSeries(table.time, this);
    this.data.openTime = this.data.time;

    // Close time series
    const closeTimeBuf = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      closeTimeBuf[i] = i + 1 < N ? table.time[i + 1] : table.time[i] + tfDuration;
    }
    this.data.closeTime = new FastSeries(closeTimeBuf, this);
    // Precompute derived price series vectorized in a single continuous pass
    const hl2Buf = new Float64Array(N);
    const hlc3Buf = new Float64Array(N);
    const ohlc4Buf = new Float64Array(N);
    const hlcc4Buf = new Float64Array(N);
    const barIndexBuf = new Float64Array(N);

    const open = table.open;
    const high = table.high;
    const low = table.low;
    const close = table.close;

    for (let i = 0; i < N; i++) {
      const o = open[i];
      const h = high[i];
      const l = low[i];
      const c = close[i];

      hl2Buf[i] = (h + l) * 0.5;
      hlc3Buf[i] = (h + l + c) / 3;
      ohlc4Buf[i] = (o + h + l + c) * 0.25;
      hlcc4Buf[i] = (h + l + c + c) * 0.25;
      barIndexBuf[i] = i;
    }

    this.data.hl2 = new FastSeries(hl2Buf, this);
    this.data.hlc3 = new FastSeries(hlc3Buf, this);
    this.data.ohlc4 = new FastSeries(ohlc4Buf, this);
    this.data.hlcc4 = new FastSeries(hlcc4Buf, this);
    this.data.bar_index = new FastSeries(barIndexBuf, this);
  }

  /**
   * Registers a pre-aligned secondary resolution series for request.security static resolution.
   */
  public registerSecuritySeries(id: string, series: FastSeries): void {
    this._securitySeries.set(id, series);
  }

  /**
   * Synchronous O(1) retrieval of statically pre-resolved security series.
   */
  public override getSecuritySeries(id: string): FastSeries {
    let s = this._securitySeries.get(id);
    if (!s) {
      s = FastSeries.allocate(this.length || 1, this, NaN);
      this._securitySeries.set(id, s);
    }
    return s;
  }

  /**
   * Resizes or ensures columnar table capacity for streaming realtime bars.
   */
  public ensureTableCapacity(capacity: number): void {
    if (!this.table) {
      const activeLen = this.length;
      this.bindTable(ColumnarBarTable.allocate(capacity));
      this.length = activeLen;
      return;
    }
    if (this.table.length < capacity) {
      const activeLen = this.length;
      const newCap = Math.max(capacity, Math.ceil(this.table.length * 1.5), 64);
      const newTable = ColumnarBarTable.allocate(newCap);
      const oldLen = this.table.length;
      newTable.time.set(this.table.time.subarray(0, oldLen), 0);
      newTable.open.set(this.table.open.subarray(0, oldLen), 0);
      newTable.high.set(this.table.high.subarray(0, oldLen), 0);
      newTable.low.set(this.table.low.subarray(0, oldLen), 0);
      newTable.close.set(this.table.close.subarray(0, oldLen), 0);
      newTable.volume.set(this.table.volume.subarray(0, oldLen), 0);
      this.bindTable(newTable);
      this.length = activeLen;
    }
  }

  /**
   * Sets the OHLCV values of a bar at index without reallocating buffers.
   */
  public setBarAt(
    index: number,
    bar: { time: number; open: number; high: number; low: number; close: number; volume: number },
  ): void {
    if (!this.table || this.table.length <= index) {
      this.ensureTableCapacity(index + 1);
    }
    const t = this.table!;
    t.time[index] = bar.time;
    t.open[index] = bar.open;
    t.high[index] = bar.high;
    t.low[index] = bar.low;
    t.close[index] = bar.close;
    t.volume[index] = bar.volume;

    const o = bar.open;
    const h = bar.high;
    const l = bar.low;
    const c = bar.close;

    if (this.data.hl2?.buffer) this.data.hl2.buffer[index] = (h + l) * 0.5;
    if (this.data.hlc3?.buffer) this.data.hlc3.buffer[index] = (h + l + c) / 3;
    if (this.data.ohlc4?.buffer) this.data.ohlc4.buffer[index] = (o + h + l + c) * 0.25;
    if (this.data.hlcc4?.buffer) this.data.hlcc4.buffer[index] = (h + l + c + c) * 0.25;
    if (this.data.bar_index?.buffer) this.data.bar_index.buffer[index] = index;
    const tfDur = getTimeframeDurationMs(this.timeframe);
    if (this.data.closeTime?.buffer) this.data.closeTime.buffer[index] = bar.time + tfDur;

    if (this.length <= index) {
      this.length = index + 1;
    }
  }
}

export default PineContext;
