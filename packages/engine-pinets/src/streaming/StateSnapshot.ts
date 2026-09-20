// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import type { StrategyState } from '../namespaces/strategy/types';
import { Context } from '../Context.class';
import { Series } from '../Series';
import { FastSeries } from '../core/FastSeries';

/**
 * Deep-clone a plain-data value (primitives, arrays, plain objects, Map, Set).
 * Designed for high-frequency streaming rollbacks without heavy GC pressure.
 */
export function clonePlainValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const len = value.length;
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = clonePlainValue(value[i]);
    }
    return arr as unknown as T;
  }

  if (value instanceof Map) {
    const copy = new Map();
    value.forEach((v, k) => copy.set(k, clonePlainValue(v)));
    return copy as unknown as T;
  }

  if (value instanceof Set) {
    const copy = new Set();
    value.forEach((v) => copy.add(clonePlainValue(v)));
    return copy as unknown as T;
  }

  if (value instanceof Float64Array) {
    return new Float64Array(value) as unknown as T;
  }

  const copy: any = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    copy[k] = clonePlainValue((value as any)[k]);
  }
  return copy;
}

export interface StrategySnapshot {
  fields: Record<string, any>;
  closedtradesLength: number;
}

export interface ContextSnapshot {
  strategy: StrategySnapshot | null;
  idx: number;
  execTick: number;
  vars: Record<string, any>;
  plotLengths: Record<string, number>;
  resultSnapshot?: any;
  alertsLength?: number;
}

/**
 * Snapshot strategy state at the close of confirmed bar N-1.
 * O(open state) snapshot skipping append-only closedtrades and immutable config.
 */
export function snapshotStrategyState(strategy: StrategyState | undefined): StrategySnapshot | null {
  if (!strategy) return null;
  const fields: Record<string, any> = {};
  const keys = Object.keys(strategy);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === 'config' || key === 'closedtrades') continue;
    fields[key] = clonePlainValue((strategy as any)[key]);
  }
  return { fields, closedtradesLength: strategy.closedtrades.length };
}

/**
 * Restore strategy state from snapshotStrategyState.
 * Mutates strategy in-place to preserve reference equality across Pine getters.
 */
export function restoreStrategyState(strategy: StrategyState | undefined, snapshot: StrategySnapshot | null): void {
  if (!strategy || !snapshot) return;

  // Clean up any keys that were created after snapshot was taken
  const currentKeys = Object.keys(strategy);
  for (let i = 0; i < currentKeys.length; i++) {
    const key = currentKeys[i];
    if (key === 'config' || key === 'closedtrades') continue;
    if (!Object.prototype.hasOwnProperty.call(snapshot.fields, key)) {
      delete (strategy as any)[key];
    }
  }

  // Restore closedtrades via length truncation (O(1) rollback, zero array recreation)
  if (strategy.closedtrades.length > snapshot.closedtradesLength) {
    strategy.closedtrades.length = snapshot.closedtradesLength;
  }

  // Restore fields
  const snapshotKeys = Object.keys(snapshot.fields);
  for (let i = 0; i < snapshotKeys.length; i++) {
    const key = snapshotKeys[i];
    (strategy as any)[key] = clonePlainValue(snapshot.fields[key]);
  }
}

/**
 * Captures full execution context state (strategy, variables, plots, drawings, results).
 */
export function takeContextSnapshot(context: Context): ContextSnapshot {
  const strategySnap = context.strategy ? snapshotStrategyState(context.strategy) : null;

  // Snapshot user vars in context.var
  const varsSnap: Record<string, any> = {};
  if (context.var) {
    const varKeys = Object.keys(context.var);
    for (let i = 0; i < varKeys.length; i++) {
      const key = varKeys[i];
      const v = context.var[key];
      if (v instanceof Series) {
        varsSnap[key] = { type: 'series', length: v.data.length };
      } else if (v instanceof FastSeries) {
        varsSnap[key] = { type: 'fast_series' };
      } else if (Array.isArray(v)) {
        varsSnap[key] = { type: 'array', data: [...v] };
      } else if (typeof v === 'object' && v !== null) {
        varsSnap[key] = { type: 'object', value: clonePlainValue(v) };
      } else {
        varsSnap[key] = { type: 'primitive', value: v };
      }
    }
  }

  // Snapshot plots array lengths
  const plotLengths: Record<string, number> = {};
  if (context.plots) {
    const plotKeys = Object.keys(context.plots);
    for (let i = 0; i < plotKeys.length; i++) {
      const key = plotKeys[i];
      const p = context.plots[key];
      if (p && Array.isArray(p.data)) {
        plotLengths[key] = p.data.length;
      }
    }
  }

  // Snapshot result
  let resultSnapshot: any = undefined;
  if (Array.isArray(context.result)) {
    resultSnapshot = { type: 'array', length: context.result.length };
  } else if (typeof context.result === 'object' && context.result !== null) {
    const lengths: Record<string, number> = {};
    const resKeys = Object.keys(context.result);
    for (let i = 0; i < resKeys.length; i++) {
      const k = resKeys[i];
      if (Array.isArray(context.result[k])) {
        lengths[k] = context.result[k].length;
      }
    }
    resultSnapshot = { type: 'object', lengths };
  }

  const alertsLength = Array.isArray((context as any).alerts) ? (context as any).alerts.length : undefined;

  return {
    strategy: strategySnap,
    idx: context.idx,
    execTick: context._execTick || 0,
    vars: varsSnap,
    plotLengths,
    resultSnapshot,
    alertsLength,
  };
}

/**
 * Restores full execution context state back to snapshot point.
 */
export function restoreContextSnapshot(context: Context, snapshot: ContextSnapshot): void {
  // 1. Restore strategy
  if (context.strategy && snapshot.strategy) {
    restoreStrategyState(context.strategy, snapshot.strategy);
  }

  // 2. Restore idx & execTick
  context.idx = snapshot.idx;
  context._execTick = snapshot.execTick;

  // 3. Restore vars
  if (context.var && snapshot.vars) {
    const varKeys = Object.keys(snapshot.vars);
    for (let i = 0; i < varKeys.length; i++) {
      const key = varKeys[i];
      const entry = snapshot.vars[key];
      if (entry.type === 'series' && context.var[key] instanceof Series) {
        context.var[key].data.length = entry.length;
      } else if (entry.type === 'array' && Array.isArray(context.var[key])) {
        context.var[key].length = entry.data.length;
        for (let j = 0; j < entry.data.length; j++) {
          context.var[key][j] = entry.data[j];
        }
      } else if (entry.type === 'object') {
        context.var[key] = clonePlainValue(entry.value);
      } else if (entry.type === 'primitive') {
        context.var[key] = entry.value;
      }
    }
  }

  // 4. Restore plots
  if (context.plots && snapshot.plotLengths) {
    const plotKeys = Object.keys(snapshot.plotLengths);
    for (let i = 0; i < plotKeys.length; i++) {
      const key = plotKeys[i];
      const p = context.plots[key];
      const targetLen = snapshot.plotLengths[key];
      if (p && Array.isArray(p.data) && p.data.length > targetLen) {
        p.data.length = targetLen;
      }
    }
  }

  // 5. Restore result
  if (snapshot.resultSnapshot) {
    if (snapshot.resultSnapshot.type === 'array' && Array.isArray(context.result)) {
      context.result.length = snapshot.resultSnapshot.length;
    } else if (
      snapshot.resultSnapshot.type === 'object' &&
      typeof context.result === 'object' &&
      context.result !== null
    ) {
      const resKeys = Object.keys(snapshot.resultSnapshot.lengths);
      for (let i = 0; i < resKeys.length; i++) {
        const k = resKeys[i];
        if (Array.isArray(context.result[k])) {
          context.result[k].length = snapshot.resultSnapshot.lengths[k];
        }
      }
    }
  }

  // 6. Rollback drawing helpers for unconfirmed forming bar
  if (typeof (context as any).rollbackDrawings === 'function') {
    (context as any).rollbackDrawings(snapshot.idx + 1);
  }

  // 7. Rollback provisional alerts
  if (typeof snapshot.alertsLength === 'number' && Array.isArray((context as any).alerts)) {
    (context as any).alerts.length = snapshot.alertsLength;
  }
}
