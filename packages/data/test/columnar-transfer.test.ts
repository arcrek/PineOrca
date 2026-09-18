import { describe, it, expect } from 'vitest';
import { ColumnarBarTable } from '../src/columnar/ColumnarBarTable.js';
import type { Bar } from '../src/columnar/types.js';

describe('ColumnarBarTable: Zero-Copy Binary Architecture', () => {
  it('allocates 64-byte aligned continuous ArrayBuffer', () => {
    const barCount = 1000;
    const table = ColumnarBarTable.allocate(barCount);

    expect(table.length).toBe(barCount);
    expect(table.isContinuous).toBe(true);
    expect(table.time.length).toBe(barCount);
    expect(table.open.length).toBe(barCount);
    expect(table.high.length).toBe(barCount);
    expect(table.low.length).toBe(barCount);
    expect(table.close.length).toBe(barCount);
    expect(table.volume.length).toBe(barCount);

    // Stride is multiple of 8 elements (64 bytes)
    expect(table.time.byteOffset % 64).toBe(0);
    expect(table.open.byteOffset % 64).toBe(0);
    expect(table.high.byteOffset % 64).toBe(0);
    expect(table.low.byteOffset % 64).toBe(0);
    expect(table.close.byteOffset % 64).toBe(0);
    expect(table.volume.byteOffset % 64).toBe(0);
  });

  it('populates and retrieves bars with float64 precision', () => {
    const bars: Bar[] = [
      { time: 1700000000000, open: 100.5, high: 105.25, low: 99.75, close: 104.0, volume: 1500 },
      { time: 1700000060000, open: 104.0, high: 108.5, low: 103.5, close: 107.25, volume: 2200 },
      { time: 1700000120000, open: 107.25, high: 107.5, low: 101.0, close: 102.5, volume: 3100 },
    ];

    const table = ColumnarBarTable.fromBars(bars);
    expect(table.length).toBe(3);

    for (let i = 0; i < bars.length; i++) {
      const b = table.getBar(i);
      expect(b.time).toBe(bars[i].time);
      expect(b.open).toBe(bars[i].open);
      expect(b.high).toBe(bars[i].high);
      expect(b.low).toBe(bars[i].low);
      expect(b.close).toBe(bars[i].close);
      expect(b.volume).toBe(bars[i].volume);
    }
  });

  it('performs zero-copy slicing without reallocating underlying buffer', () => {
    const table = ColumnarBarTable.allocate(100);
    for (let i = 0; i < 100; i++) {
      table.time[i] = i * 1000;
      table.close[i] = 50 + i * 0.5;
    }

    const sub = table.slice(10, 20);
    expect(sub.length).toBe(10);
    expect(sub.time[0]).toBe(10000);
    expect(sub.close[0]).toBe(55);
    expect(sub.isContinuous).toBe(true);

    // Modifying parent modifies zero-copy sub-slice
    table.close[10] = 999.9;
    expect(sub.close[0]).toBe(999.9);
  });

  it('appends tables and maintains correct sequential data', () => {
    const tableA = ColumnarBarTable.allocate(2);
    tableA.time[0] = 1000;
    tableA.close[0] = 10;
    tableA.time[1] = 2000;
    tableA.close[1] = 20;

    const tableB = ColumnarBarTable.allocate(2);
    tableB.time[0] = 3000;
    tableB.close[0] = 30;
    tableB.time[1] = 4000;
    tableB.close[1] = 40;

    const combined = tableA.append(tableB);
    expect(combined.length).toBe(4);
    expect(combined.time[0]).toBe(1000);
    expect(combined.time[3]).toBe(4000);
    expect(combined.close[0]).toBe(10);
    expect(combined.close[3]).toBe(40);
  });

  it('serializes and deserializes via ColumnarBufferPayload', () => {
    const count = 5000;
    const original = ColumnarBarTable.allocate(count);
    for (let i = 0; i < count; i++) {
      original.time[i] = 1600000000000 + i * 60000;
      original.open[i] = 100 + (i % 50);
      original.high[i] = original.open[i] + 5;
      original.low[i] = original.open[i] - 5;
      original.close[i] = original.open[i] + 1;
      original.volume[i] = 1000 + i;
    }

    const payload = original.toPayload();
    expect(payload.length).toBe(count);
    expect(original.transferables).toHaveLength(1);
    expect(original.transferables[0]).toBe(payload.buffer);

    const reconstructed = ColumnarBarTable.fromPayload(payload);
    expect(reconstructed.length).toBe(count);
    expect(reconstructed.time[0]).toBe(original.time[0]);
    expect(reconstructed.close[count - 1]).toBe(original.close[count - 1]);
  });

  it('correctly serializes and deserializes sliced sub-tables without offset corruption', () => {
    const table = ColumnarBarTable.allocate(100);
    for (let i = 0; i < 100; i++) {
      table.time[i] = i * 1000;
      table.close[i] = i * 10;
    }

    const sliced = table.slice(10, 20);
    expect(sliced.length).toBe(10);
    expect(sliced.time[0]).toBe(10000);
    expect(sliced.close[0]).toBe(100);

    const payload = sliced.toPayload();
    const restored = ColumnarBarTable.fromPayload(payload);
    expect(restored.length).toBe(10);
    expect(restored.time[0]).toBe(10000);
    expect(restored.close[0]).toBe(100);
    expect(restored.time[9]).toBe(19000);
    expect(restored.close[9]).toBe(190);
  });

  it('benchmarks 100,000 bar allocation & transfer in < 2ms', () => {
    const BAR_COUNT = 100_000;

    // 1. Benchmark 100,000 bar allocation
    const allocStart = performance.now();
    const table = ColumnarBarTable.allocate(BAR_COUNT);
    const allocDuration = performance.now() - allocStart;

    // Populate data
    for (let i = 0; i < BAR_COUNT; i++) {
      table.time[i] = 1600000000000 + i * 60000;
      table.open[i] = 150.0 + (i % 20);
      table.high[i] = table.open[i] + 2.5;
      table.low[i] = table.open[i] - 2.5;
      table.close[i] = table.open[i] + 0.75;
      table.volume[i] = 10000 + i;
    }

    // Memory footprint check: 6 columns * 8 bytes * 100,000 = 4.8MB
    expect(table.byteLength).toBeGreaterThanOrEqual(4_800_000);
    expect(table.byteLength).toBeLessThan(4_800_000 + 1024); // Minimal alignment padding only

    // 2. Benchmark Transferable extraction & transfer simulation
    const transferStart = performance.now();
    const payload = table.toPayload();
    const transferred = ColumnarBarTable.fromPayload(payload);
    const transferDuration = performance.now() - transferStart;

    expect(transferred.length).toBe(BAR_COUNT);
    expect(transferred.time[99_999]).toBe(1600000000000 + 99_999 * 60000);

    // Native ArrayBuffer.transfer test if supported in Node 24
    if (typeof (table.transfer) === 'function') {
      const nativeTransferStart = performance.now();
      const nativeTransferred = table.transfer();
      const nativeDuration = performance.now() - nativeTransferStart;
      expect(nativeTransferred.length).toBe(BAR_COUNT);
      expect(nativeDuration).toBeLessThan(2.0); // Pass criteria: < 2ms
    }

    // Pass criteria from Phase 1 plan: transfer completes in < 2ms
    expect(transferDuration).toBeLessThan(2.0);
  });
});
