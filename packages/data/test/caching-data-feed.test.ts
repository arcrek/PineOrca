import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from 'fake-indexeddb';
import { CachingDataFeed } from '../src/feed/CachingDataFeed.js';
import { ColumnarBarStore } from '../src/columnar/ColumnarBarStore.js';
import { IndexedDBStore } from '../src/storage/IndexedDBStore.js';
import { ColumnarBarTable } from '../src/columnar/ColumnarBarTable.js';
import type { DataFeedProvider } from '../src/feed/types.js';
import type { Bar } from '../src/columnar/types.js';

Object.defineProperty(globalThis, 'IDBKeyRange', {
  value: fakeKeyRange,
  configurable: true,
  writable: true,
});

describe('CachingDataFeed: Unified Multi-Tier Orchestrator', () => {
  let l1: ColumnarBarStore;
  let l2: IndexedDBStore;
  let feed: CachingDataFeed;
  let mockFetchCount = 0;

  const mockProvider: DataFeedProvider = {
    name: 'mock-binance',
    async fetchBars(symbol: string, timeframe: string, startTime: number, endTime: number): Promise<Bar[]> {
      mockFetchCount++;
      const bars: Bar[] = [];
      let t = startTime;
      while (t <= endTime) {
        bars.push({
          time: t,
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 50,
        });
        t += 60000;
      }
      return bars;
    },
  };

  beforeEach(() => {
    mockFetchCount = 0;
    l1 = new ColumnarBarStore({ chunkSize: 1000, maxChunks: 5 });
    l2 = new IndexedDBStore({
      dbName: `test-feed-db-${Date.now()}-${Math.random()}`,
      idbFactory: fakeIDB,
      chunkSize: 500,
      compression: false,
    });
    feed = new CachingDataFeed({
      l1Cache: l1,
      l2Cache: l2,
      provider: mockProvider,
    });
  });

  afterEach(async () => {
    await l2.close();
  });

  it('orchestrates L1 -> L2 -> L3 transparently and caches hot data', async () => {
    const start = 1700000000000;
    const end = 1700000000000 + 10 * 60000;

    // First request: L1 miss, L2 miss -> calls mockProvider L3
    const bars1 = await feed.getBars('BTCUSDT', '1m', start, end);
    expect(bars1.length).toBe(11);
    expect(mockFetchCount).toBe(1);

    // Second request: L1 hit -> should not call mockProvider or L2
    const bars2 = await feed.getBars('BTCUSDT', '1m', start, end);
    expect(bars2.length).toBe(11);
    expect(mockFetchCount).toBe(1);
    expect(l1.stats().hits).toBeGreaterThan(0);

    // Clear L1 memory: third request -> L2 hit from IndexedDB!
    l1.clear();
    const bars3 = await feed.getBars('BTCUSDT', '1m', start, end);
    expect(bars3.length).toBe(11);
    expect(mockFetchCount).toBe(1); // Still 1! Served from L2 IndexedDB
    expect(l1.stats().chunkCount).toBeGreaterThan(0); // Repopulated L1
  });

  it('preloads and invalidates caches', async () => {
    const table = ColumnarBarTable.allocate(10);
    for (let i = 0; i < 10; i++) {
      table.time[i] = 1600000000000 + i * 1000;
      table.close[i] = 50 + i;
    }

    await feed.preload('ETHUSDT', '1h', table);

    const retrieved = await feed.getBars('ETHUSDT', '1h', 1600000000000, 1600000009000);
    expect(retrieved.length).toBe(10);
    expect(mockFetchCount).toBe(0);

    await feed.invalidate('ETHUSDT', '1h');
    // Now querying will miss L1 and L2, triggering L3
    await feed.getBars('ETHUSDT', '1h', 1600000000000, 1600000002000);
    expect(mockFetchCount).toBe(1);
  });

  it('deduplicates concurrent in-flight requests for the same range', async () => {
    const start = 1710000000000;
    const end = 1710000000000 + 5 * 60000;

    // Fire 5 concurrent requests simultaneously
    const [r1, r2, r3, r4, r5] = await Promise.all([
      feed.getBars('BNBUSDT', '1m', start, end),
      feed.getBars('BNBUSDT', '1m', start, end),
      feed.getBars('BNBUSDT', '1m', start, end),
      feed.getBars('BNBUSDT', '1m', start, end),
      feed.getBars('BNBUSDT', '1m', start, end),
    ]);

    expect(r1.length).toBe(6);
    expect(r2.length).toBe(6);
    expect(r3.length).toBe(6);
    expect(r4.length).toBe(6);
    expect(r5.length).toBe(6);
    // Provider was called only once despite 5 concurrent callers!
    expect(mockFetchCount).toBe(1);
  });
});
