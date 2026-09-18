import { ColumnarBarTable } from '../columnar/ColumnarBarTable.js';
import { ColumnarBufferPayload } from '../columnar/types.js';

export interface IndexedDBStoreOptions {
  /** Database name (default: 'pineorca-data') */
  dbName?: string;
  /** Database version (default: 1) */
  dbVersion?: number;
  /** Bars per persistent chunk (default: 1,000) */
  chunkSize?: number;
  /** Whether to compress binary chunks with gzip CompressionStream (default: true) */
  compression?: boolean;
  /** Custom IDBFactory instance (useful in Node.js / test environments) */
  idbFactory?: IDBFactory;
}

export interface StoredChunkRecord {
  key: string;
  symbol: string;
  timeframe: string;
  chunkId: number | string;
  barCount: number;
  startTime: number;
  endTime: number;
  nextStartTime?: number;
  stride: number;
  compressed: boolean;
  data: Uint8Array;
  updatedAt: number;
}

/**
 * L2 persistent storage holding 1,000-bar binary chunks in IndexedDB.
 * Compresses binary buffers and indexes chunks by symbol, timeframe, and chunkIndex.
 */
export class IndexedDBStore {
  public static readonly DEFAULT_DB_NAME = 'pineorca-data';
  public static readonly DEFAULT_CHUNK_SIZE = 1_000;
  public static readonly STORE_NAME = 'chunks';

  public readonly dbName: string;
  public readonly dbVersion: number;
  public readonly chunkSize: number;
  public readonly compression: boolean;

  private readonly _idbFactory: IDBFactory | undefined;
  private _dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBStoreOptions = {}) {
    this.dbName = options.dbName ?? IndexedDBStore.DEFAULT_DB_NAME;
    this.dbVersion = options.dbVersion ?? 1;
    this.chunkSize = options.chunkSize ?? IndexedDBStore.DEFAULT_CHUNK_SIZE;
    this.compression = options.compression ?? true;
    this._idbFactory = options.idbFactory;
  }

  public static makeKey(
    symbol: string,
    timeframe: string,
    chunkId: number | string,
  ): string {
    return `${symbol}:${timeframe}:${chunkId}`;
  }

  private _getIDBFactory(): IDBFactory {
    if (this._idbFactory) {
      return this._idbFactory;
    }
    if (typeof indexedDB !== 'undefined') {
      return indexedDB;
    }
    throw new Error(
      'IndexedDB is not available in the current runtime environment. Provide options.idbFactory.',
    );
  }

  public async open(): Promise<IDBDatabase> {
    if (this._dbPromise) {
      return this._dbPromise;
    }

    const factory = this._getIDBFactory();
    this._dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IndexedDBStore.STORE_NAME)) {
          const store = db.createObjectStore(IndexedDBStore.STORE_NAME, { keyPath: 'key' });
          store.createIndex('by_series', ['symbol', 'timeframe'], { unique: false });
          store.createIndex('by_time', ['symbol', 'timeframe', 'startTime'], { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });

    return this._dbPromise;
  }

  public async close(): Promise<void> {
    if (this._dbPromise) {
      const db = await this._dbPromise;
      db.close();
      this._dbPromise = null;
    }
  }

  /**
   * Persists a single 1,000-bar chunk into IndexedDB.
   */
  public async putChunk(
    symbol: string,
    timeframe: string,
    chunkId: number | string,
    table: ColumnarBarTable,
    nextStartTime?: number,
  ): Promise<void> {
    const db = await this.open();
    const key = IndexedDBStore.makeKey(symbol, timeframe, chunkId);

    const payload = table.toPayload();
    let rawBytes: Uint8Array<ArrayBuffer> = new Uint8Array(payload.buffer);
    let isCompressed = false;

    if (this.compression && typeof CompressionStream !== 'undefined') {
      rawBytes = await this._compress(rawBytes);
      isCompressed = true;
    }

    const record: StoredChunkRecord = {
      key,
      symbol,
      timeframe,
      chunkId,
      barCount: table.length,
      startTime: table.length > 0 ? table.time[0] : 0,
      endTime: table.length > 0 ? table.time[table.length - 1] : 0,
      nextStartTime,
      stride: payload.stride,
      compressed: isCompressed,
      data: rawBytes,
      updatedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IndexedDBStore.STORE_NAME, 'readwrite');
      const store = tx.objectStore(IndexedDBStore.STORE_NAME);
      store.put(record);

      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error(`Transaction aborted for chunk ${key}`));
      tx.onerror = () =>
        reject(tx.error ?? new Error(`Failed to put chunk ${key}`));
    });
  }

  /**
   * Retrieves and reconstitutes a single 1,000-bar chunk from IndexedDB.
   */
  public async getChunk(
    symbol: string,
    timeframe: string,
    chunkId: number | string,
  ): Promise<ColumnarBarTable | null> {
    const db = await this.open();
    const key = IndexedDBStore.makeKey(symbol, timeframe, chunkId);
    const record = await new Promise<StoredChunkRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(IndexedDBStore.STORE_NAME, 'readonly');
      const store = tx.objectStore(IndexedDBStore.STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => resolve(req.result as StoredChunkRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error(`Failed to get chunk ${key}`));
    });

    if (!record) {
      return null;
    }

    let rawBuffer: ArrayBuffer;
    if (record.compressed && typeof DecompressionStream !== 'undefined') {
      rawBuffer = await this._decompress(record.data);
    } else {
      const sliceBuf = new ArrayBuffer(record.data.byteLength);
      new Uint8Array(sliceBuf).set(record.data);
      rawBuffer = sliceBuf;
    }

    const payload: ColumnarBufferPayload = {
      length: record.barCount,
      stride: record.stride,
      buffer: rawBuffer,
    };

    return ColumnarBarTable.fromPayload(payload);
  }

  /**
   * Persists an entire ColumnarBarTable by chunking it into 1,000-bar chunks.
   */
  public async putBars(
    symbol: string,
    timeframe: string,
    table: ColumnarBarTable,
    startingChunkIndex?: number,
  ): Promise<void> {
    if (table.length === 0) return;

    let offset = 0;
    let chunkIdx = startingChunkIndex;

    while (offset < table.length) {
      const end = Math.min(offset + this.chunkSize, table.length);
      const slice = table.copySlice(offset, end);
      const chunkId = chunkIdx !== undefined ? chunkIdx : slice.time[0];
      const nextStartTime = end < table.length ? table.time[end] : undefined;

      await this.putChunk(symbol, timeframe, chunkId, slice, nextStartTime);
      offset = end;
      if (chunkIdx !== undefined) {
        chunkIdx++;
      }
    }
  }

  /**
   * Queries stored chunks covering the time range [startTime, endTime].
   */
  public async getRange(
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime: number,
  ): Promise<ColumnarBarTable | null> {
    const db = await this.open();

    const records = await new Promise<StoredChunkRecord[]>((resolve, reject) => {
      const tx = db.transaction(IndexedDBStore.STORE_NAME, 'readonly');
      const store = tx.objectStore(IndexedDBStore.STORE_NAME);
      const index = store.index('by_series');
      const range = IDBKeyRange.only([symbol, timeframe]);
      const req = index.getAll(range);

      req.onsuccess = () => resolve((req.result as StoredChunkRecord[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error('Failed to query series'));
    });

    // Filter matching chunks covering [startTime, endTime]
    const matching = records.filter(
      (r) => r.barCount > 0 && r.startTime <= endTime && r.endTime >= startTime,
    );

    if (matching.length === 0) {
      return null;
    }

    // Sort by startTime ascending
    matching.sort((a, b) => a.startTime - b.startTime);

    // Verify boundary coverage
    if (matching[0].startTime > startTime || matching[matching.length - 1].endTime < endTime) {
      return null;
    }

    // Verify there are no missing intermediate chunks in the persistent store
    for (let i = 0; i < matching.length - 1; i++) {
      const current = matching[i];
      const next = matching[i + 1];
      if (current.nextStartTime !== undefined) {
        if (next.startTime !== current.nextStartTime) {
          return null;
        }
      } else {
        const step =
          current.endTime > current.startTime && current.barCount > 1
            ? (current.endTime - current.startTime) / (current.barCount - 1)
            : 0;
        if (step > 0 && next.startTime > current.endTime + step * 1.5) {
          return null;
        }
      }
    }
    // Load and decode each matching chunk
    const tables: ColumnarBarTable[] = [];
    for (const record of matching) {
      let rawBuffer: ArrayBuffer;
      if (record.compressed && typeof DecompressionStream !== 'undefined') {
        rawBuffer = await this._decompress(record.data);
      } else {
        const sliceBuf = new ArrayBuffer(record.data.byteLength);
        new Uint8Array(sliceBuf).set(record.data);
        rawBuffer = sliceBuf;
      }
      tables.push(
        ColumnarBarTable.fromPayload({
          length: record.barCount,
          stride: record.stride,
          buffer: rawBuffer,
        }),
      );
    }

    let merged = tables[0];
    for (let i = 1; i < tables.length; i++) {
      merged = merged.append(tables[i]);
    }

    // Slice to exact [startTime, endTime] range via binary search
    const startIndex = this._findFirstIndexGte(merged.time, startTime);
    const endIndex = this._findLastIndexLte(merged.time, endTime) + 1;

    if (startIndex >= endIndex) {
      return ColumnarBarTable.allocate(0);
    }

    return merged.copySlice(startIndex, endIndex);
  }

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

  /**
   * Deletes all chunks associated with a symbol and timeframe.
   */
  public async deleteSeries(symbol: string, timeframe: string): Promise<void> {
    const db = await this.open();
    const keysToDelete = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(IndexedDBStore.STORE_NAME, 'readonly');
      const store = tx.objectStore(IndexedDBStore.STORE_NAME);
      const index = store.index('by_series');
      const range = IDBKeyRange.only([symbol, timeframe]);
      const req = index.getAllKeys(range);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (keysToDelete.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IndexedDBStore.STORE_NAME, 'readwrite');
      const store = tx.objectStore(IndexedDBStore.STORE_NAME);
      for (const key of keysToDelete) {
        store.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Purges all chunks from the store.
   */
  public async clear(): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IndexedDBStore.STORE_NAME, 'readwrite');
      const store = tx.objectStore(IndexedDBStore.STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private async _compress(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    await writer.write(data);
    await writer.close();

    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.length;
      }
    }

    const resultBuffer = new ArrayBuffer(totalLen);
    const result = new Uint8Array(resultBuffer);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  private async _decompress(compressed: Uint8Array): Promise<ArrayBuffer> {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const compressedBuffer = new ArrayBuffer(compressed.byteLength);
    new Uint8Array(compressedBuffer).set(compressed);
    await writer.write(new Uint8Array(compressedBuffer));
    await writer.close();

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.length;
      }
    }

    const resultBuffer = new ArrayBuffer(totalLen);
    const result = new Uint8Array(resultBuffer);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return resultBuffer;
  }
}
