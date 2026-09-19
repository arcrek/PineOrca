// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { FastSeries } from '../src/core/FastSeries';

describe('FastSeries Benchmark & Semantics', () => {
  it('honors Pine Script reverse indexing semantics and NaN out-of-bounds', () => {
    const N = 100;
    const buf = new Float64Array(N);
    for (let i = 0; i < N; i++) buf[i] = (i + 1) * 10;

    const ctx = { idx: 10 };
    const series = new FastSeries(buf, ctx);

    // Current bar (idx 10): value is (10+1)*10 = 110
    expect(series.get(0)).toBe(110);
    // 1 bar ago (idx 9): value is 100
    expect(series.get(1)).toBe(100);
    // 10 bars ago (idx 0): value is 10
    expect(series.get(10)).toBe(10);
    // 11 bars ago (out of bounds): NaN
    expect(Number.isNaN(series.get(11))).toBe(true);
    // Negative lookback (future): NaN
    expect(Number.isNaN(series.get(-1))).toBe(true);
    // NaN lookback (dynamic lookback evaluation to na): NaN
    expect(Number.isNaN(series.get(NaN))).toBe(true);
    expect(typeof series.get(NaN)).toBe('number');
    // Infinite lookback: NaN
    expect(Number.isNaN(series.get(Infinity))).toBe(true);
    expect(Number.isNaN(series.get(-Infinity))).toBe(true);

    // Mutation via set
    series.set(0, 999);
    expect(series.get(0)).toBe(999);
    expect(buf[10]).toBe(999);

    // Parameter offset delegation
    const offsetSeries = new FastSeries(buf, ctx, 2);
    // offset 2 + lookback 0 = 2 bars ago (idx 8 = 90)
    expect(offsetSeries.get(0)).toBe(90);
  });

  it('exceeds 5,000,000 lookbacks/sec on 100,000 bars', () => {
    const BAR_COUNT = 100_000;
    const buf = new Float64Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      buf[i] = Math.sin(i) * 100 + 150;
    }

    const ctx = { idx: 0 };
    const series = new FastSeries(buf, ctx);

    // Warmup JIT
    for (let i = 0; i < 5000; i++) {
      ctx.idx = i;
      series.get(0);
      series.get(1);
      series.get(5);
    }

    const LOOKBACK_SAMPLES = 50;
    const ITERATIONS = BAR_COUNT - LOOKBACK_SAMPLES;
    let sum = 0;

    const start = performance.now();
    for (let i = LOOKBACK_SAMPLES; i < BAR_COUNT; i++) {
      ctx.idx = i;
      for (let k = 0; k < LOOKBACK_SAMPLES; k++) {
        sum += series.get(k);
      }
    }
    const elapsedMs = performance.now() - start;

    const totalLookbacks = ITERATIONS * LOOKBACK_SAMPLES;
    const lookbacksPerSec = (totalLookbacks / elapsedMs) * 1000;

    console.log(
      `FastSeries Benchmark: ${totalLookbacks.toLocaleString()} lookbacks in ${elapsedMs.toFixed(2)}ms (${Math.round(lookbacksPerSec).toLocaleString()} lookbacks/sec)`,
    );

    expect(sum).not.toBeNaN();
    expect(lookbacksPerSec).toBeGreaterThan(5_000_000);
  });
});
