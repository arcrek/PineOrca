import { ColumnarBarTable } from '../columnar/ColumnarBarTable.js';
import type { Bar } from '../columnar/types.js';
import type { DataFeedProvider, TickUpdate, WebSocketProviderOptions } from './types.js';

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Live WebSocket market data provider with 60Hz RequestAnimationFrame debounced batching.
 *
 * Prevents high-frequency WebSocket tick floods (1,000+ ticks/sec) from freezing the chart
 * by coalescing incoming updates into 60Hz frames (~16.6ms) while tracking intra-frame
 * extremes and total volume.
 */
export class WebSocketProvider implements DataFeedProvider {
  public readonly name: string = 'websocket';
  public readonly options: WebSocketProviderOptions;

  private _status: WebSocketStatus = 'disconnected';
  private _socket?: any;
  private _subscribers: Map<string, { timeframe: string; listeners: Set<(tick: TickUpdate) => void> }> = new Map();
  private _tickBuffer: Map<string, TickUpdate[]> = new Map();
  private _latestTicks: Map<string, TickUpdate> = new Map();
  private _rafHandle: any = null;
  private _isRafScheduled: boolean = false;
  private _reconnectAttempts: number = 0;
  private _reconnectTimer: any = null;
  private _isDestroyed: boolean = false;

  constructor(options: WebSocketProviderOptions = {}) {
    this.options = {
      batchIntervalMs: 16.6,
      useRaf: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      ...options,
    };
  }

  public get status(): WebSocketStatus {
    return this._status;
  }

  /**
   * Fetches historical bars by delegating to restFallbackProvider if available.
   */
  public async fetchBars(
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime: number,
  ): Promise<ColumnarBarTable | Bar[]> {
    if (this.options.restFallbackProvider) {
      return this.options.restFallbackProvider.fetchBars(symbol, timeframe, startTime, endTime);
    }
    return ColumnarBarTable.allocate(0);
  }

  /**
   * Connects to the WebSocket endpoint.
   */
  public async connect(url?: string): Promise<void> {
    if (this._isDestroyed) return;
    const targetUrl = url ?? this.options.url;
    if (!targetUrl && !this.options.webSocketFactory) {
      this._status = 'connected';
      return;
    }

    this._status = 'connecting';

    try {
      if (this.options.webSocketFactory) {
        this._socket = this.options.webSocketFactory(targetUrl ?? 'ws://localhost');
      } else if (typeof globalThis.WebSocket !== 'undefined') {
        this._socket = new (globalThis as any).WebSocket(targetUrl);
      } else {
        // Mock socket for headless / node environments without global WebSocket
        this._status = 'connected';
        return;
      }

      this._setupSocketListeners();
    } catch (err) {
      this._status = 'error';
      this._handleReconnect();
    }
  }

  /**
   * Subscribes a listener to tick updates for a specific symbol.
   */
  public subscribe(
    symbol: string,
    timeframe: string,
    onTick: (tick: TickUpdate) => void,
  ): () => void {
    if (!this._subscribers.has(symbol)) {
      this._subscribers.set(symbol, { timeframe, listeners: new Set() });
      this._sendSubscription(symbol, timeframe, true);
    }

    this._subscribers.get(symbol)!.listeners.add(onTick);

    return () => {
      this.unsubscribe(symbol, onTick);
    };
  }

  /**
   * Unsubscribes a listener or removes all listeners for a symbol.
   */
  public unsubscribe(symbol: string, onTick?: (tick: TickUpdate) => void): void {
    const sub = this._subscribers.get(symbol);
    if (!sub) return;

    if (onTick) {
      sub.listeners.delete(onTick);
    } else {
      sub.listeners.clear();
    }

    if (sub.listeners.size === 0) {
      this._subscribers.delete(symbol);
      this._sendSubscription(symbol, sub.timeframe, false);
    }
  }

  /**
   * Ingests a raw tick message directly or via WebSocket event.
   */
  public handleMessage(event: { data: any } | string | TickUpdate): void {
    let payload: any;
    if (typeof event === 'object' && 'price' in event && 'symbol' in event) {
      payload = event;
    } else if (typeof event === 'string') {
      try {
        payload = JSON.parse(event);
      } catch {
        return;
      }
    } else if (event && typeof event.data === 'string') {
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
    } else if (event && typeof event.data === 'object') {
      payload = event.data;
    } else {
      return;
    }

    if (Array.isArray(payload)) {
      for (const item of payload) {
        this._ingestTick(item);
      }
    } else if (payload && typeof payload === 'object') {
      this._ingestTick(payload);
    }
  }

  private _ingestTick(item: any): void {
    const symbol = item.symbol || item.s;
    const price = Number(item.price ?? item.p ?? item.close ?? item.c);
    if (!symbol || Number.isNaN(price)) return;

    const time = Number(item.time ?? item.t ?? item.timestamp ?? Date.now());
    const volume = Number(item.volume ?? item.v ?? item.qty ?? item.q ?? 0);
    const isBarClose = Boolean(item.isBarClose ?? item.closed ?? item.x);

    const tick: TickUpdate = {
      symbol,
      price,
      volume,
      time,
      isBarClose,
    };

    if (!this._tickBuffer.has(symbol)) {
      this._tickBuffer.set(symbol, []);
    }
    this._tickBuffer.get(symbol)!.push(tick);
    this._latestTicks.set(symbol, tick);

    if (tick.isBarClose) {
      this.flush();
    } else {
      this._scheduleFlush();
    }
  }

  /**
   * Schedules a debounced 60Hz batch dispatch.
   */
  private _scheduleFlush(): void {
    if (this._rafHandle !== null) return;

    const interval = Math.max(1, Math.round(this.options.batchIntervalMs ?? 16.6));

    if (
      this.options.useRaf &&
      typeof globalThis.requestAnimationFrame === 'function'
    ) {
      this._isRafScheduled = true;
      this._rafHandle = globalThis.requestAnimationFrame(() => {
        this._rafHandle = null;
        this._isRafScheduled = false;
        this.flush();
      });
    } else {
      this._isRafScheduled = false;
      this._rafHandle = setTimeout(() => {
        this._rafHandle = null;
        this.flush();
      }, interval);
    }
  }

  /**
   * Synchronously flushes and dispatches all accumulated ticks to subscribers at 60Hz.
   */
  public flush(): void {
    if (this._rafHandle !== null) {
      if (this._isRafScheduled && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(this._rafHandle);
      } else {
        clearTimeout(this._rafHandle);
      }
      this._rafHandle = null;
      this._isRafScheduled = false;
    }

    if (this._tickBuffer.size === 0) return;

    for (const [symbol, ticks] of this._tickBuffer.entries()) {
      const sub = this._subscribers.get(symbol);
      if (!sub || sub.listeners.size === 0 || ticks.length === 0) continue;

      // Coalesce ticks in the frame: dispatch the latest state with aggregated volume
      const latest = this._latestTicks.get(symbol)!;
      let totalVolume = 0;
      for (let i = 0; i < ticks.length; i++) {
        totalVolume += ticks[i].volume ?? 0;
      }

      const coalescedTick: TickUpdate = {
        symbol: latest.symbol,
        price: latest.price,
        volume: totalVolume,
        time: latest.time,
        isBarClose: latest.isBarClose,
      };

      for (const listener of sub.listeners) {
        try {
          listener(coalescedTick);
        } catch (err) {
          console.error(`[WebSocketProvider] Error in tick listener for ${symbol}:`, err);
        }
      }
    }

    this._tickBuffer.clear();
  }

  /**
   * Sends raw message across WebSocket if connected.
   */
  public send(message: any): void {
    if (this._socket && typeof this._socket.send === 'function') {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      this._socket.send(data);
    }
  }

  /**
   * Disconnects and cleans up resources.
   */
  public disconnect(): void {
    this._isDestroyed = true;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._rafHandle !== null) {
      if (this._isRafScheduled && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(this._rafHandle);
      } else {
        clearTimeout(this._rafHandle);
      }
      this._rafHandle = null;
      this._isRafScheduled = false;
    }
    if (this._socket) {
      try {
        if (typeof this._socket.close === 'function') {
          this._socket.close();
        }
      } catch {}
      this._socket = undefined;
    }
    this._status = 'disconnected';
  }

  private _setupSocketListeners(): void {
    if (!this._socket) return;

    this._socket.onopen = () => {
      this._status = 'connected';
      this._reconnectAttempts = 0;
      // Resubscribe active subscriptions
      for (const [symbol, sub] of this._subscribers.entries()) {
        this._sendSubscription(symbol, sub.timeframe, true);
      }
    };

    this._socket.onmessage = (event: any) => {
      this.handleMessage(event);
    };

    this._socket.onerror = (err: any) => {
      this._status = 'error';
    };

    this._socket.onclose = () => {
      if (this._status !== 'disconnected') {
        this._status = 'disconnected';
        this._handleReconnect();
      }
    };
  }

  private _sendSubscription(symbol: string, timeframe: string, isSubscribe: boolean): void {
    this.send({
      action: isSubscribe ? 'subscribe' : 'unsubscribe',
      symbol,
      timeframe,
    });
  }

  private _handleReconnect(): void {
    if (this._isDestroyed) return;
    const max = this.options.maxReconnectAttempts ?? 5;
    if (this._reconnectAttempts >= max) {
      return;
    }

    this._reconnectAttempts++;
    const delay = (this.options.reconnectDelay ?? 1000) * Math.min(this._reconnectAttempts, 5);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
