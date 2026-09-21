// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { ColumnarBarTable } from '@pineorca/data';

/**
 * Deterministically generates high-resolution golden bars for BTC/USDT.
 * Uses a seeded pseudo-random walk to ensure identical, repeatable price action.
 */
export function getGoldenBarTable(count: number = 5000): ColumnarBarTable {
  const table = ColumnarBarTable.allocate(count);
  const baseTime = 1609459200000; // 2021-01-01 00:00:00 UTC
  const barInterval = 3600_000; // 1 hour
  let currentPrice = 30000.0; // Initial price

  // Deterministic LCG pseudo-random generator
  let seed = 42;
  const nextRandom = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    const time = baseTime + i * barInterval;
    const changePct = (nextRandom() - 0.496) * 0.02; // slight upward institutional drift
    const open = currentPrice;
    const close = Math.round(open * (1 + changePct) * 100) / 100;
    const high = Math.round(Math.max(open, close) * (1 + nextRandom() * 0.008) * 100) / 100;
    const low = Math.round(Math.min(open, close) * (1 - nextRandom() * 0.008) * 100) / 100;
    const volume = Math.round(100 + nextRandom() * 900);

    table.time[i] = time;
    table.open[i] = open;
    table.high[i] = high;
    table.low[i] = low;
    table.close[i] = close;
    table.volume[i] = volume;

    currentPrice = close;
  }

  return table;
}
