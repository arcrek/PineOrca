// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { Series } from '../Series';

export interface IndexContext {
  idx: number;
}

/**
 * High-performance struct-of-arrays series wrapper over continuous Float64Array.
 * Delivers O(1) reverse indexing with 0 heap allocations and zero GC churn:
 * get(lookback) resolves to buffer[currentIndex - (offset + Math.trunc(lookback))].
 */
export class FastSeries {
  public readonly buffer: Float64Array;
  public readonly context?: IndexContext;
  public readonly offset: number;
  private _currentIndex: number = 0;

  constructor(
    buffer: Float64Array,
    context?: IndexContext,
    offset: number = 0,
  ) {
    this.buffer = buffer;
    this.context = context;
    this.offset = offset;
  }

  public get currentIndex(): number {
    return this.context ? this.context.idx : this._currentIndex;
  }

  public set currentIndex(val: number) {
    this._currentIndex = val;
  }

  /**
   * Access series with Pine Script reverse indexing semantics:
   * - index 0 is current bar
   * - index 1 is 1 bar ago
   * - out-of-bounds (< 0, > currentIndex, >= buffer.length) or negative lookback returns NaN
   */
  public get(index: number = 0): number {
    let lookback = this.offset + index;
    if (!Number.isFinite(lookback) || lookback < 0) {
      return NaN;
    }
    if (!Number.isInteger(lookback)) {
      lookback = Math.trunc(lookback);
    }
    const curIdx = this.context ? this.context.idx : this._currentIndex;
    const realIndex = curIdx - lookback;
    if (realIndex < 0 || realIndex > curIdx || realIndex >= this.buffer.length) {
      return NaN;
    }
    return this.buffer[realIndex];
  }

  /**
   * Sets value at lookback offset relative to current bar.
   */
  public set(index: number, value: number): void {
    let lookback = this.offset + index;
    if (!Number.isFinite(lookback) || lookback < 0) {
      return;
    }
    if (!Number.isInteger(lookback)) {
      lookback = Math.trunc(lookback);
    }
    const curIdx = this.context ? this.context.idx : this._currentIndex;
    const realIndex = curIdx - lookback;
    if (realIndex >= 0 && realIndex <= curIdx && realIndex < this.buffer.length) {
      this.buffer[realIndex] = value;
    }
  }

  /**
   * Number of bars visible up to current index.
   */
  public get length(): number {
    const cur = this.context ? this.context.idx : this._currentIndex;
    return cur < 0 ? 0 : Math.min(cur + 1, this.buffer.length);
  }

  /**
   * Total allocated capacity of underlying buffer.
   */
  public get capacity(): number {
    return this.buffer.length;
  }

  /**
   * Current bar scalar value.
   */
  public get value(): number {
    return this.get(0);
  }

  public toArray(): number[] {
    const len = this.length;
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = this.buffer[i];
    }
    return arr;
  }

  public toTypedArray(): Float64Array {
    return this.buffer.subarray(0, this.length);
  }

  /**
   * Pre-allocates a Float64Array FastSeries filled with NaNs.
   */
  public static allocate(capacity: number, context?: IndexContext, initialValue: number = NaN): FastSeries {
    const buf = new Float64Array(capacity);
    if (!Number.isNaN(initialValue)) {
      buf.fill(initialValue);
    } else {
      buf.fill(NaN);
    }
    return new FastSeries(buf, context);
  }

  /**
   * Coerce any source into a FastSeries or Series.
   */
  public static from(source: any, context?: IndexContext): FastSeries | Series {
    if (source instanceof FastSeries) return source;
    if (source instanceof Series) return source;
    if (source instanceof Float64Array) return new FastSeries(source, context);
    if (Array.isArray(source)) {
      const isNum = source.length === 0 || typeof source[0] === 'number';
      if (isNum) {
        const buf = new Float64Array(source);
        const s = new FastSeries(buf, context);
        if (!context) s.currentIndex = source.length - 1;
        return s;
      }
      return new Series(source);
    }
    if (source != null && typeof source === 'object' && '__value' in source) {
      const inner = source.__value;
      if (inner instanceof FastSeries || inner instanceof Series) return inner;
      if (typeof inner === 'number') {
        const buf = new Float64Array([inner]);
        const s = new FastSeries(buf, context);
        if (!context) s.currentIndex = 0;
        return s;
      }
    }
    if (typeof source === 'number') {
      const buf = new Float64Array([source]);
      const s = new FastSeries(buf, context);
      if (!context) s.currentIndex = 0;
      return s;
    }
    return new Series([source]);
  }
}
