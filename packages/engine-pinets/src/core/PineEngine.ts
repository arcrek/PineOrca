// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { Context } from '../Context.class';
import { PineContext } from './PineContext';
import { FastSeries } from './FastSeries';
import { Series } from '../Series';
import {
  processStrategyOrders,
  processExitOrders,
  processMarginCall,
  finalizeStrategyBar,
  finalizeStrategyRun,
  isAdverseFirstBar,
  applyPendingCloseMarginCall,
} from '../namespaces/strategy/utils';

export interface ExecutionOptions {
  startIdx?: number;
  endIdx?: number;
  onProgress?: (currentBar: number, totalBars: number) => void;
  progressInterval?: number;
  isCancelled?: () => boolean;
}

/**
 * High-performance Pine Script Execution Engine.
 * Supports zero-overhead synchronous execution loops for backtesting,
 * with real-time cancellation and progress notifications.
 */
export class PineEngine {
  private static readonly CONTEXT_VAR_NAMES = ['const', 'var', 'let', 'params'];

  /**
   * Synchronous hot-loop execution across historical bars.
   * Eliminates 100% of Promise microtask scheduling overhead.
   */
  public static executeSync(
    context: Context,
    transpiledFn: Function,
    options: ExecutionOptions = {},
  ): void {
    const totalBars = context.length;
    const startIdx = options.startIdx ?? 0;
    const endIdx = options.endIdx ?? totalBars;
    const progressInterval = options.progressInterval ?? 5000;
    const onProgress = options.onProgress;
    const isCancelled = options.isCancelled;

    for (let i = startIdx; i < endIdx; i++) {
      if (isCancelled && isCancelled()) {
        break;
      }

      context.idx = i;
      context._execTick = (context._execTick || 0) + 1;

      // Strategy broker emulator checkpoints
      if (context.strategy) {
        applyPendingCloseMarginCall(context);
        processStrategyOrders(context);
        processMarginCall(context, 'open');
        const adverseFirst = isAdverseFirstBar(context);
        if (adverseFirst) processMarginCall(context, 'extreme');
        processExitOrders(context, 'intrabar');
        if (!adverseFirst) processMarginCall(context, 'extreme');
        finalizeStrategyBar(context);
      }

      // Synchronous execution of transpiled script
      const result = transpiledFn(context);

      // Collect outputs into context.result
      this.collectResult(context, result);

      // Synchronize drawing helper objects
      if (context._drawingHelpers) {
        for (let d = 0; d < context._drawingHelpers.length; d++) {
          const helper = context._drawingHelpers[d];
          if (helper.syncToPlot) helper.syncToPlot();
        }
      }

      // Shift user series variables
      this.shiftVariables(context);

      // Progress reporting
      if (onProgress && (i % progressInterval === 0 || i === endIdx - 1)) {
        onProgress(i + 1, totalBars);
      }
    }

    // Finalize strategy metrics and risk ratios
    if (context.strategy) {
      finalizeStrategyRun(context);
    }
  }

  /**
   * Asynchronous execution loop fallback when asynchronous external operations are required.
   */
  public static async executeAsync(
    context: Context,
    transpiledFn: Function,
    options: ExecutionOptions = {},
  ): Promise<void> {
    const totalBars = context.length;
    const startIdx = options.startIdx ?? 0;
    const endIdx = options.endIdx ?? totalBars;
    const progressInterval = options.progressInterval ?? 5000;
    const onProgress = options.onProgress;
    const isCancelled = options.isCancelled;

    for (let i = startIdx; i < endIdx; i++) {
      if (isCancelled && isCancelled()) {
        break;
      }

      context.idx = i;
      context._execTick = (context._execTick || 0) + 1;

      if (context.strategy) {
        applyPendingCloseMarginCall(context);
        processStrategyOrders(context);
        processMarginCall(context, 'open');
        const adverseFirst = isAdverseFirstBar(context);
        if (adverseFirst) processMarginCall(context, 'extreme');
        processExitOrders(context, 'intrabar');
        if (!adverseFirst) processMarginCall(context, 'extreme');
        finalizeStrategyBar(context);
      }

      const result = await transpiledFn(context);
      this.collectResult(context, result);

      if (context._drawingHelpers) {
        for (let d = 0; d < context._drawingHelpers.length; d++) {
          const helper = context._drawingHelpers[d];
          if (helper.syncToPlot) helper.syncToPlot();
        }
      }

      this.shiftVariables(context);

      if (onProgress && (i % progressInterval === 0 || i === endIdx - 1)) {
        onProgress(i + 1, totalBars);
      }
    }

    if (context.strategy) {
      finalizeStrategyRun(context);
    }
  }

  private static collectResult(context: Context, result: any): void {
    if (typeof result === 'object' && result !== null) {
      if (typeof context.result !== 'object' || context.result === null) {
        context.result = {};
      }
      for (const key in result) {
        if (context.result[key] === undefined) {
          context.result[key] = [];
        }
        const val =
          result[key] instanceof FastSeries || result[key] instanceof Series
            ? result[key].get(0)
            : Array.isArray(result[key])
              ? result[key][result[key].length - 1]
              : result[key];
        context.result[key].push(val);
      }
    } else {
      if (!Array.isArray(context.result)) {
        context.result = [];
      }
      context.result.push(result);
    }
  }

  private static shiftVariables(context: Context): void {
    const shift = (container: any) => {
      for (let c = 0; c < this.CONTEXT_VAR_NAMES.length; c++) {
        const name = this.CONTEXT_VAR_NAMES[c];
        const sub = container[name];
        if (!sub) continue;
        for (const k in sub) {
          const item = sub[k];
          if (item instanceof Series) {
            item.data.push(item.get(0));
          } else if (Array.isArray(item)) {
            item.push(item[item.length - 1]);
          }
          // FastSeries requires no push — accesses index relative to context.idx directly
        }
      }
    };

    shift(context);
    if (context.lctx) {
      context.lctx.forEach((l) => shift(l));
    }
  }
}

export default PineEngine;
