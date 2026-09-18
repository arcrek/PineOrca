import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from 'fake-indexeddb';
import { IndexedDBStore } from '../src/storage/IndexedDBStore.js';
import { ColumnarBarStore } from '../src/columnar/ColumnarBarStore.js';
import { ColumnarBarTable } from '../src/columnar/ColumnarBarTable.js';
// Polyfill global IndexedDB primitives for fake-indexeddb environment
Object.defineProperty(globalThis, 'IDBKeyRange', {
  value: fakeKeyRange,
  configurable: true,
  writable: true,
});

describe('IndexedDBStore: L2 Binary Storage with Gzip Compression', () => {
  let store: IndexedDBStore;

  beforeEach(() => {
    store = new IndexedDBStore({
      dbName: `test-db-${Date.now()}-${Math.random()}`,
      idbFactory: fakeIDB,
      chunkSize: 1000,
      compression: true,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it('persists and retrieves a 1,000-bar chunk with binary fidelity', async () => {
    const table = ColumnarBarTable.allocate(1000);
    for (let i = 0; i < 1000; i++) {
      table.time[i] = 1700000000000 + i * 60000;
      table.open[i] = 200 + i * 0.1;
      table.high[i] = table.open[i] + 1.5;
      table.low[i] = table.open[i] - 1.5;
      table.close[i] = table.open[i] + 0.2;
      table.volume[i] = 5000 + i * 10;
    }

    await store.putChunk('BTCUSDT', '1m', 0, table);

    const retrieved = await store.getChunk('BTCUSDT', '1m', 0);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(1000);

    // Verify exact floating point precision across all values
    for (let i = 0; i < 1000; i++) {
      expect(retrieved!.time[i]).toBe(table.time[i]);
      expect(retrieved!.open[i]).toBe(table.open[i]);
      expect(retrieved!.high[i]).toBe(table.high[i]);
      expect(retrieved!.low[i]).toBe(table.low[i]);
      expect(retrieved!.close[i]).toBe(table.close[i]);
      expect(retrieved!.volume[i]).toBe(table.volume[i]);
    }
  });

  it('splits and stitches multi-chunk ranges across chunk boundaries', async () => {
    const TOTAL_BARS = 3500; // Will split into chunks 0, 1, 2, 3 (sizes: 1000, 1000, 1000, 500)
    const table = ColumnarBarTable.allocate(TOTAL_BARS);
    const baseTime = 1600000000000;

    for (let i = 0; i < TOTAL_BARS; i++) {
      table.time[i] = baseTime + i * 60000;
      table.open[i] = 100 + i * 0.05;
      table.high[i] = table.open[i] + 1;
      table.low[i] = table.open[i] - 1;
      table.close[i] = table.open[i] + 0.5;
      table.volume[i] = 1000 + i;
    }

    await store.putBars('ETHUSDT', '5m', table);

    // Query partial range crossing chunks 1 and 2 (e.g. index 1200 to 2800)
    const queryStartTime = baseTime + 1200 * 60000;
    const queryEndTime = baseTime + 2800 * 60000;

    const range = await store.getRange('ETHUSDT', '5m', queryStartTime, queryEndTime);
    expect(range).not.toBeNull();
    expect(range!.length).toBe(1601); // 2800 - 1200 + 1

    expect(range!.time[0]).toBe(queryStartTime);
    expect(range!.time[range!.length - 1]).toBe(queryEndTime);
    expect(range!.open[0]).toBe(table.open[1200]);
    expect(range!.close[range!.length - 1]).toBe(table.close[2800]);
  });

  it('deletes stored series correctly', async () => {
    const table = ColumnarBarTable.allocate(500);
    await store.putChunk('SOLUSDT', '1h', 0, table);

    const before = await store.getChunk('SOLUSDT', '1h', 0);
    expect(before).not.toBeNull();

    await store.deleteSeries('SOLUSDT', '1h');

    const after = await store.getChunk('SOLUSDT', '1h', 0);
    expect(after).toBeNull();
  });

  it('does not clobber disjoint historical batches in IndexedDBStore', async () => {
    const batch1 = ColumnarBarTable.allocate(100);
    for (let i = 0; i < 100; i++) {
      batch1.time[i] = 1700000000000 + i * 1000;
      batch1.close[i] = 100 + i;
    }

    const batch2 = ColumnarBarTable.allocate(100);
    for (let i = 0; i < 100; i++) {
      batch2.time[i] = 1705000000000 + i * 1000;
      batch2.close[i] = 200 + i;
    }

    await store.putBars('BTCUSDT', '1m', batch1);
    await store.putBars('BTCUSDT', '1m', batch2);

    const res1 = await store.getRange(
      'BTCUSDT',
      '1m',
      1700000000000,
      1700000099000,
    );
    const res2 = await store.getRange(
      'BTCUSDT',
      '1m',
      1705000000000,
      1705000099000,
    );

    expect(res1).not.toBeNull();
    expect(res1!.length).toBe(100);
    expect(res1!.close[0]).toBe(100);

    expect(res2).not.toBeNull();
    expect(res2!.length).toBe(100);
    expect(res2!.close[0]).toBe(200);
  });

  it('detects missing intermediate chunks in IndexedDB and returns null', async () => {
    const c0 = ColumnarBarTable.allocate(10);
    for (let i = 0; i < 10; i++) c0.time[i] = i * 1000;
    await store.putChunk('BTC', '1m', 0, c0);

    // Chunk 1 (10..19s) missing!
    const c2 = ColumnarBarTable.allocate(10);
    for (let i = 0; i < 10; i++) c2.time[i] = (20 + i) * 1000;
    await store.putChunk('BTC', '1m', 2, c2);

    const res = await store.getRange('BTC', '1m', 0, 25000);
    expect(res).toBeNull();
  });
});

describe('ColumnarBarStore: L1 In-Memory LRU Cache', () => {
  it('stores and retrieves chunks with LRU eviction', () => {
    const store = new ColumnarBarStore({
      chunkSize: 100,
      maxChunks: 3,
    });

    const c0 = ColumnarBarTable.allocate(100);
    const c1 = ColumnarBarTable.allocate(100);
    const c2 = ColumnarBarTable.allocate(100);
    const c3 = ColumnarBarTable.allocate(100);

    store.putChunk('BTC', '1m', 0, c0);
    store.putChunk('BTC', '1m', 1, c1);
    store.putChunk('BTC', '1m', 2, c2);

    expect(store.stats().chunkCount).toBe(3);
    expect(store.stats().evictions).toBe(0);

    // Access chunk 0 to make it most-recently used; chunk 1 becomes LRU
    expect(store.getChunk('BTC', '1m', 0)).not.toBeNull();

    // Insert chunk 3 -> should evict chunk 1
    store.putChunk('BTC', '1m', 3, c3);

    expect(store.stats().chunkCount).toBe(3);
    expect(store.stats().evictions).toBe(1);
    expect(store.getChunk('BTC', '1m', 1)).toBeNull(); // Evicted
    expect(store.getChunk('BTC', '1m', 0)).not.toBeNull(); // Retained
    expect(store.getChunk('BTC', '1m', 2)).not.toBeNull(); // Retained
    expect(store.getChunk('BTC', '1m', 3)).not.toBeNull(); // Retained
  });

  it('stitches ranges across in-memory chunks', () => {
    const store = new ColumnarBarStore({ chunkSize: 50, maxChunks: 10 });
    const table = ColumnarBarTable.allocate(150);
    for (let i = 0; i < 150; i++) {
      table.time[i] = 1000 + i * 100;
      table.close[i] = 10 + i;
    }

    store.putBars('AAPL', '1d', table);

    const range = store.getRange('AAPL', '1d', 1500, 11000);
    expect(range).not.toBeNull();
    expect(range!.time[0]).toBe(1500);
    expect(range!.time[range!.length - 1]).toBe(11000);
    expect(range!.length).toBe(96);
  });

  it('detects intermediate missing chunks in ColumnarBarStore and returns null', () => {
    const store = new ColumnarBarStore({ chunkSize: 10, maxChunks: 10 });
    const c0 = ColumnarBarTable.allocate(10);
    for (let i = 0; i < 10; i++) c0.time[i] = i * 1000;
    store.putChunk('BTC', '1m', 0, c0);

    // Chunk 1 missing
    const c2 = ColumnarBarTable.allocate(10);
    for (let i = 0; i < 10; i++) c2.time[i] = (20 + i) * 1000;
    store.putChunk('BTC', '1m', 2, c2);

    const res = store.getRange('BTC', '1m', 0, 25000);
    expect(res).toBeNull();
  });

  it('deletes only matching series on deleteSeries', () => {
    const store = new ColumnarBarStore({ chunkSize: 10, maxChunks: 10 });
    const c0 = ColumnarBarTable.allocate(10);
    c0.time[0] = 1000;
    const c1 = ColumnarBarTable.allocate(10);
    c1.time[0] = 1000;

    store.putChunk('BTC', '1m', 0, c0);
    store.putChunk('ETH', '1m', 0, c1);

    expect(store.getChunk('BTC', '1m', 0)).not.toBeNull();
    expect(store.getChunk('ETH', '1m', 0)).not.toBeNull();

    store.deleteSeries('BTC', '1m');

    expect(store.getChunk('BTC', '1m', 0)).toBeNull();
    expect(store.getChunk('ETH', '1m', 0)).not.toBeNull();
  });
});
