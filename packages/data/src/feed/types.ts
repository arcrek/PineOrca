import type { ColumnarBarTable } from '../columnar/ColumnarBarTable.js';
import type { Bar } from '../columnar/types.js';
import type { ColumnarBarStore } from '../columnar/ColumnarBarStore.js';
import type { IndexedDBStore } from '../storage/IndexedDBStore.js';

/**
 * Interface for L3 external data feed providers (REST / WebSocket).
 */
export interface DataFeedProvider {
  readonly name: string;
  fetchBars(
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime: number,
  ): Promise<ColumnarBarTable | Bar[]>;
}

/**
 * Configuration options for CachingDataFeed.
 */
export interface CachingDataFeedOptions {
  /** In-memory L1 chunk cache */
  l1Cache?: ColumnarBarStore;
  /** IndexedDB L2 persistent cache */
  l2Cache?: IndexedDBStore;
  /** Default external L3 provider */
  provider?: DataFeedProvider;
  /** Named providers for multi-exchange routing */
  providers?: Record<string, DataFeedProvider>;
}

/**
 * Real-time tick or trade update.
 */
export interface TickUpdate {
  symbol: string;
  price: number;
  volume?: number;
  time: number;
  isBarClose?: boolean;
}

/**
 * Configuration options for WebSocketProvider.
 */
export interface WebSocketProviderOptions {
  url?: string;
  webSocketFactory?: (url: string) => any;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  batchIntervalMs?: number;
  useRaf?: boolean;
  restFallbackProvider?: DataFeedProvider;
}
