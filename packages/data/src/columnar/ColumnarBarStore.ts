import { ColumnarBarTable } from './ColumnarBarTable.js';

export interface ColumnarBarStoreOptions {
  /** Maximum number of 64k chunks to retain in memory (default: 32 chunks = ~2,048,000 bars = ~98MB) */
  maxChunks?: number;
  /** Chunk size in bars (default: 64,000 bars per chunk) */
  chunkSize?: number;
}

export interface CacheStats {
  chunkCount: number;
  totalBars: number;
  estimatedMemoryBytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

interface ChunkMeta {
  symbol: string;
  timeframe: string;
  chunkIdentifier: number | string;
  startTime: number;
  endTime: number;
  nextStartTime?: number;
  table: ColumnarBarTable;
}

/**
 * L1 in-memory LRU cache storing hot OHLCV windows in 64,000-bar columnar chunks.
 * Evicts least-recently-used chunks when exceeding maxChunks capacity.
 */
export class ColumnarBarStore {
  public static readonly DEFAULT_CHUNK_SIZE = 64_000;
  public static readonly DEFAULT_MAX_CHUNKS = 32;

  public readonly chunkSize: number;
  public readonly maxChunks: number;

  private readonly _chunks = new Map<string, ChunkMeta>();
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(options: ColumnarBarStoreOptions = {}) {
    this.chunkSize = options.chunkSize ?? ColumnarBarStore.DEFAULT_CHUNK_SIZE;
    this.maxChunks = options.maxChunks ?? ColumnarBarStore.DEFAULT_MAX_CHUNKS;
    if (this.chunkSize <= 0) {
      throw new RangeError(`chunkSize must be positive: ${this.chunkSize}`);
    }
    if (this.maxChunks <= 0) {
      throw new RangeError(`maxChunks must be positive: ${this.maxChunks}`);
    }
  }

  public static makeKey(
    symbol: string,
    timeframe: string,
    chunkIdentifier: number | string,
  ): string {
    return `${symbol}:${timeframe}:${chunkIdentifier}`;
  }

  /**
   * Retrieves a single chunk if cached, updating LRU order.
   */
  public getChunk(
    symbol: string,
    timeframe: string,
    chunkIdentifier: number | string,
  ): ColumnarBarTable | null {
    const key = ColumnarBarStore.makeKey(symbol, timeframe, chunkIdentifier);
    const meta = this._chunks.get(key);
    if (!meta) {
      this._misses++;
      return null;
    }

    // Move to end of Map (most recently used)
    this._chunks.delete(key);
    this._chunks.set(key, meta);
    this._hits++;
    return meta.table;
  }

  /**
   * Stores a 64k-bar chunk, evicting the LRU chunk if capacity is reached.
   */
  public putChunk(
    symbol: string,
    timeframe: string,
    chunkIdentifier: number | string,
    table: ColumnarBarTable,
    nextStartTime?: number,
  ): void {
    const key = ColumnarBarStore.makeKey(symbol, timeframe, chunkIdentifier);

    if (this._chunks.has(key)) {
      this._chunks.delete(key);
    } else if (this._chunks.size >= this.maxChunks) {
      this._evictLRU();
    }

    const startTime = table.length > 0 ? table.time[0] : 0;
    const endTime = table.length > 0 ? table.time[table.length - 1] : 0;

    this._chunks.set(key, {
      symbol,
      timeframe,
      chunkIdentifier,
      startTime,
      endTime,
      nextStartTime,
      table,
    });
  }

  /**
   * Stores a contiguous bar table by splitting it into 64k-bar chunks.
   */
  public putBars(
    symbol: string,
    timeframe: string,
    table: ColumnarBarTable,
    startingChunkIndex?: number,
  ): void {
    if (table.length === 0) return;

    let offset = 0;
    let currentChunkIdx = startingChunkIndex;

    while (offset < table.length) {
      const end = Math.min(offset + this.chunkSize, table.length);
      const slice = table.copySlice(offset, end);
      const chunkId =
        currentChunkIdx !== undefined ? currentChunkIdx : slice.time[0];
      const nextStartTime = end < table.length ? table.time[end] : undefined;

      this.putChunk(symbol, timeframe, chunkId, slice, nextStartTime);
      offset = end;
      if (currentChunkIdx !== undefined) {
        currentChunkIdx++;
      }
    }
  }

  /**
   * Queries in-memory chunks for a time range [startTime, endTime].
   * Returns a merged ColumnarBarTable if complete range is present, or null if any part misses.
   */
  public getRange(
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime: number,
  ): ColumnarBarTable | null {
    if (startTime > endTime) {
      return ColumnarBarTable.allocate(0);
    }

    // Locate all chunks for this symbol:timeframe that intersect [startTime, endTime]
    const matching: ChunkMeta[] = [];
    for (const meta of this._chunks.values()) {
      if (meta.symbol === symbol && meta.timeframe === timeframe) {
        if (meta.table.length > 0 && meta.startTime <= endTime && meta.endTime >= startTime) {
          matching.push(meta);
        }
      }
    }

    if (matching.length === 0) {
      this._misses++;
      return null;
    }

    // Sort by startTime ascending
    matching.sort((a, b) => a.startTime - b.startTime);

    // Verify continuity across matching chunks
    const first = matching[0];
    const last = matching[matching.length - 1];

    if (first.startTime > startTime || last.endTime < endTime) {
      this._misses++;
      return null;
    }

    // Verify there are no missing intermediate chunks / gaps
    for (let i = 0; i < matching.length - 1; i++) {
      const current = matching[i];
      const next = matching[i + 1];
      if (current.nextStartTime !== undefined) {
        if (next.startTime !== current.nextStartTime) {
          this._misses++;
          return null; // Missing intermediate chunk
        }
      } else {
        const step =
          current.table.length > 1
            ? current.table.time[1] - current.table.time[0]
            : next.table.length > 1
              ? next.table.time[1] - next.table.time[0]
              : 0;
        if (step > 0 && next.startTime > current.endTime + step * 1.5) {
          this._misses++;
          return null;
        }
      }
    }
    // Stitch matching chunks together
    let merged = matching[0].table;
    for (let i = 1; i < matching.length; i++) {
      merged = merged.append(matching[i].table);
    }

    // Find indices within [startTime, endTime] using binary search on time column
    const startIndex = this._findFirstIndexGte(merged.time, startTime);
    const endIndex = this._findLastIndexLte(merged.time, endTime) + 1;

    if (startIndex >= endIndex) {
      return ColumnarBarTable.allocate(0);
    }

    this._hits++;
    return merged.copySlice(startIndex, endIndex);
  }

  /**
   * Binary search for first index where time >= target.
   */
  private _findFirstIndexGte(time: Float64Array, target: number): number {
    let low = 0;
    let high = time.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (time[mid] >= target) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    return low;
  }

  /**
   * Binary search for last index where time <= target.
   */
  private _findLastIndexLte(time: Float64Array, target: number): number {
    let low = 0;
    let high = time.length - 1;
    let result = -1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (time[mid] <= target) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  private _evictLRU(): void {
    const oldestKey = this._chunks.keys().next().value;
    if (oldestKey !== undefined) {
      this._chunks.delete(oldestKey);
      this._evictions++;
    }
  }

  public deleteSeries(symbol: string, timeframe: string): void {
    for (const [key, meta] of this._chunks.entries()) {
      if (meta.symbol === symbol && meta.timeframe === timeframe) {
        this._chunks.delete(key);
      }
    }
  }

  public clear(): void {
    this._chunks.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  public stats(): CacheStats {
    let totalBars = 0;
    let estimatedMemoryBytes = 0;
    for (const meta of this._chunks.values()) {
      totalBars += meta.table.length;
      estimatedMemoryBytes += meta.table.byteLength;
    }
    return {
      chunkCount: this._chunks.size,
      totalBars,
      estimatedMemoryBytes,
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
    };
  }
}
