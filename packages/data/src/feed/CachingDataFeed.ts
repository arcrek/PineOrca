import { ColumnarBarTable } from '../columnar/ColumnarBarTable.js';
import { ColumnarBarStore } from '../columnar/ColumnarBarStore.js';
import { IndexedDBStore } from '../storage/IndexedDBStore.js';
import type { CachingDataFeedOptions, DataFeedProvider } from './types.js';

/**
 * Unified high-performance market data provider orchestrating:
 * - L1: In-memory LRU ColumnarBarStore (64k-bar slices)
 * - L2: Persistent IndexedDBStore (1k-bar compressed binary chunks)
 * - L3: Remote network data feed providers (REST / WebSocket)
 */
export class CachingDataFeed {
  public readonly l1: ColumnarBarStore;
  public readonly l2?: IndexedDBStore;
  private readonly _providers: Map<string, DataFeedProvider> = new Map();
  private readonly _inFlight: Map<string, Promise<ColumnarBarTable>> = new Map();
  private _defaultProvider?: DataFeedProvider;

  constructor(options: CachingDataFeedOptions = {}) {
    this.l1 = options.l1Cache ?? new ColumnarBarStore();
    this.l2 = options.l2Cache;

    if (options.provider) {
      this.registerProvider(options.provider, true);
    }
    if (options.providers) {
      for (const [_, provider] of Object.entries(options.providers)) {
        this.registerProvider(provider, !this._defaultProvider);
      }
    }
  }

  /**
   * Registers a remote data feed provider.
   */
  public registerProvider(provider: DataFeedProvider, isDefault: boolean = false): void {
    this._providers.set(provider.name, provider);
    if (isDefault || !this._defaultProvider) {
      this._defaultProvider = provider;
    }
  }

  /**
   * Retrieves OHLCV bars for the requested time range [startTime, endTime].
   * Checks L1 -> L2 -> L3 in succession, populating higher tiers on cache misses.
   */
  public async getBars(
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime: number,
    providerName?: string,
  ): Promise<ColumnarBarTable> {
    if (startTime > endTime) {
      return ColumnarBarTable.allocate(0);
    }

    const inFlightKey = `${symbol}:${timeframe}:${startTime}:${endTime}:${providerName ?? ''}`;
    const existing = this._inFlight.get(inFlightKey);
    if (existing) {
      return existing;
    }

    const promise = this._getBarsInternal(
      symbol,
      timeframe,
      startTime,
      endTime,
      providerName,
    );
    this._inFlight.set(inFlightKey, promise);

    try {
      return await promise;
    } finally {
      this._inFlight.delete(inFlightKey);
    }
  }

  private async _getBarsInternal(
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime: number,
    providerName?: string,
  ): Promise<ColumnarBarTable> {
    // 1. Check L1 in-memory cache
    const l1Result = this.l1.getRange(symbol, timeframe, startTime, endTime);
    if (l1Result) {
      return l1Result;
    }

    // 2. Check L2 IndexedDB persistent cache
    if (this.l2) {
      const l2Result = await this.l2.getRange(symbol, timeframe, startTime, endTime);
      if (l2Result && l2Result.length > 0) {
        // Populate L1 cache for subsequent fast reads
        this.l1.putBars(symbol, timeframe, l2Result);
        return l2Result;
      }
    }

    // 3. Fall back to L3 remote provider
    const provider = providerName ? this._providers.get(providerName) : this._defaultProvider;
    if (!provider) {
      throw new Error(
        `No data provider available for ${symbol}:${timeframe}. Register a provider with CachingDataFeed.`,
      );
    }

    const remoteData = await provider.fetchBars(symbol, timeframe, startTime, endTime);
    const table = Array.isArray(remoteData)
      ? ColumnarBarTable.fromBars(remoteData)
      : remoteData;

    // Cache into L2 (persistent storage) and L1 (memory)
    if (table.length > 0) {
      if (this.l2) {
        await this.l2.putBars(symbol, timeframe, table);
      }
      this.l1.putBars(symbol, timeframe, table);
    }

    return table;
  }

  /**
   * Preloads an in-memory or persisted range directly into L1 and L2.
   */
  public async preload(
    symbol: string,
    timeframe: string,
    table: ColumnarBarTable,
  ): Promise<void> {
    this.l1.putBars(symbol, timeframe, table);
    if (this.l2) {
      await this.l2.putBars(symbol, timeframe, table);
    }
  }

  /**
   * Invalidates caches for a given symbol and timeframe.
   */
  public async invalidate(symbol: string, timeframe: string): Promise<void> {
    this.l1.deleteSeries(symbol, timeframe);
    if (this.l2) {
      await this.l2.deleteSeries(symbol, timeframe);
    }
  }
}
