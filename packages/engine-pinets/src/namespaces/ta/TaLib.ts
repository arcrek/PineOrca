// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import TechnicalAnalysis from './ta.index';

/**
 * Unified Technical Analysis Library.
 * Provides 60+ incremental stateful Pine indicators with callsite isolation,
 * alongside zero-allocation vectorized calculations on continuous Float64Arrays.
 */
export class TaLib {
  /**
   * Instantiates the incremental Pine technical analysis namespace for an execution context.
   */
  public static create(context: any): TechnicalAnalysis {
    return new TechnicalAnalysis(context);
  }

  /**
   * Vectorized technical analysis calculations running directly over continuous Float64Array columns.
   */
  public static readonly vectorized = {
    /**
     * Vectorized Simple Moving Average.
     */
    sma(source: Float64Array, period: number): Float64Array {
      const len = source.length;
      const out = new Float64Array(len);
      if (period <= 0 || len === 0) {
        out.fill(NaN);
        return out;
      }

      let sum = 0;
      let validCount = 0;

      for (let i = 0; i < len; i++) {
        const val = source[i];
        if (!Number.isNaN(val)) {
          sum += val;
          validCount++;
        }

        if (i >= period) {
          const oldVal = source[i - period];
          if (!Number.isNaN(oldVal)) {
            sum -= oldVal;
            validCount--;
          }
        }

        if (i >= period - 1 && validCount === period) {
          out[i] = sum / period;
        } else {
          out[i] = NaN;
        }
      }
      return out;
    },

    /**
     * Vectorized Exponential Moving Average.
     */
    ema(source: Float64Array, period: number): Float64Array {
      const len = source.length;
      const out = new Float64Array(len);
      if (period <= 0 || len === 0) {
        out.fill(NaN);
        return out;
      }

      const alpha = 2 / (period + 1);
      let prevEma = NaN;

      // Seed with initial SMA
      let seedSum = 0;
      let seedCount = 0;
      let seedIndex = -1;

      for (let i = 0; i < len; i++) {
        const val = source[i];
        if (Number.isNaN(val)) {
          out[i] = NaN;
          continue;
        }

        if (seedIndex === -1) {
          seedSum += val;
          seedCount++;
          if (seedCount === period) {
            prevEma = seedSum / period;
            out[i] = prevEma;
            seedIndex = i;
          } else {
            out[i] = NaN;
          }
        } else {
          prevEma = alpha * val + (1 - alpha) * prevEma;
          out[i] = prevEma;
        }
      }
      return out;
    },

    /**
     * Vectorized Relative Strength Index (Wilder's RMA smoothing).
     */
    rsi(source: Float64Array, period: number = 14): Float64Array {
      const len = source.length;
      const out = new Float64Array(len);
      if (period <= 0 || len <= period) {
        out.fill(NaN);
        return out;
      }

      const alpha = 1 / period;
      let avgGain = 0;
      let avgLoss = 0;

      for (let i = 1; i <= period; i++) {
        const diff = source[i] - source[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss -= diff;
        out[i - 1] = NaN;
      }

      avgGain /= period;
      avgLoss /= period;

      out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

      for (let i = period + 1; i < len; i++) {
        const diff = source[i] - source[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;

        avgGain = alpha * gain + (1 - alpha) * avgGain;
        avgLoss = alpha * loss + (1 - alpha) * avgLoss;

        if (avgLoss === 0) {
          out[i] = 100;
        } else {
          const rs = avgGain / avgLoss;
          out[i] = 100 - 100 / (1 + rs);
        }
      }
      return out;
    },

    /**
     * Vectorized Moving Average Convergence Divergence (MACD).
     */
    macd(
      source: Float64Array,
      fastPeriod: number = 12,
      slowPeriod: number = 26,
      signalPeriod: number = 9,
    ): { macd: Float64Array; signal: Float64Array; hist: Float64Array } {
      const len = source.length;
      const fastEma = this.ema(source, fastPeriod);
      const slowEma = this.ema(source, slowPeriod);

      const macdLine = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        macdLine[i] = fastEma[i] - slowEma[i];
      }

      const signalLine = this.ema(macdLine, signalPeriod);
      const hist = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        hist[i] = macdLine[i] - signalLine[i];
      }

      return { macd: macdLine, signal: signalLine, hist };
    },

    /**
     * Vectorized Standard Deviation.
     */
    stdev(source: Float64Array, period: number): Float64Array {
      const len = source.length;
      const out = new Float64Array(len);
      if (period <= 1 || len < period) {
        out.fill(NaN);
        return out;
      }

      const mean = this.sma(source, period);

      for (let i = period - 1; i < len; i++) {
        const m = mean[i];
        if (Number.isNaN(m)) {
          out[i] = NaN;
          continue;
        }
        let varianceSum = 0;
        for (let k = 0; k < period; k++) {
          const d = source[i - k] - m;
          varianceSum += d * d;
        }
        out[i] = Math.sqrt(varianceSum / period);
      }
      return out;
    },

    /**
     * Vectorized Bollinger Bands.
     */
    bb(
      source: Float64Array,
      period: number = 20,
      mult: number = 2.0,
    ): { basis: Float64Array; upper: Float64Array; lower: Float64Array } {
      const len = source.length;
      const basis = this.sma(source, period);
      const dev = this.stdev(source, period);

      const upper = new Float64Array(len);
      const lower = new Float64Array(len);

      for (let i = 0; i < len; i++) {
        const b = basis[i];
        const d = dev[i] * mult;
        upper[i] = b + d;
        lower[i] = b - d;
      }

      return { basis, upper, lower };
    },

    /**
     * Vectorized Average True Range (ATR).
     */
    atr(
      high: Float64Array,
      low: Float64Array,
      close: Float64Array,
      period: number = 14,
    ): Float64Array {
      const len = high.length;
      const tr = new Float64Array(len);
      tr[0] = high[0] - low[0];

      for (let i = 1; i < len; i++) {
        const h = high[i];
        const l = low[i];
        const prevClose = close[i - 1];
        const hl = h - l;
        const hc = Math.abs(h - prevClose);
        const lc = Math.abs(l - prevClose);
        tr[i] = Math.max(hl, hc, lc);
      }

      // RMA of True Range
      const out = new Float64Array(len);
      const alpha = 1 / period;
      let sum = 0;

      for (let i = 0; i < Math.min(period, len); i++) {
        sum += tr[i];
        out[i] = NaN;
      }

      if (len >= period) {
        let prevAtr = sum / period;
        out[period - 1] = prevAtr;

        for (let i = period; i < len; i++) {
          prevAtr = alpha * tr[i] + (1 - alpha) * prevAtr;
          out[i] = prevAtr;
        }
      }

      return out;
    },
  };
}

export default TaLib;
