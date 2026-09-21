// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  YahooFinanceProvider,
  BinanceProvider,
  Provider,
  type Kline,
} from '../src/marketData';

describe('Market Data Providers Integration', () => {
  describe('Provider Registry', () => {
    it('registers Binance and Yahoo providers in Provider dictionary', () => {
      expect(Provider.Binance).toBeInstanceOf(BinanceProvider);
      expect(Provider.Yahoo).toBeInstanceOf(YahooFinanceProvider);
    });
  });

  describe('YahooFinanceProvider', () => {
    let provider: YahooFinanceProvider;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      provider = new YahooFinanceProvider();
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('parses Yahoo v8 JSON response into valid Kline array', async () => {
      const mockYahooResponse = {
        chart: {
          result: [
            {
              meta: {
                currency: 'USD',
                symbol: 'AAPL',
                exchangeTimezoneName: 'America/New_York',
                regularMarketPrice: 150.25,
                priceHint: 2,
              },
              timestamp: [1700000000, 1700086400],
              indicators: {
                quote: [
                  {
                    open: [150.0, 152.0],
                    high: [155.0, 156.5],
                    low: [149.5, 151.0],
                    close: [153.2, 154.8],
                    volume: [1000000, 1200000],
                  },
                ],
              },
            },
          ],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockYahooResponse,
      } as any);

      const klines: Kline[] = await provider.getMarketData('AAPL', 'D', 10);

      expect(klines).toHaveLength(2);
      expect(klines[0]).toMatchObject({
        openTime: 1700000000000,
        open: 150.0,
        high: 155.0,
        low: 149.5,
        close: 153.2,
        volume: 1000000,
      });
      expect(klines[0].closeTime).toBeGreaterThan(klines[0].openTime);
      expect(klines[1].openTime).toBe(1700086400000);
      expect(klines[1].close).toBe(154.8);
    });

    it('filters out null/incomplete bars caused by market closures', async () => {
      const mockYahooResponse = {
        chart: {
          result: [
            {
              meta: { symbol: 'MSFT' },
              timestamp: [1700000000, 1700086400, 1700172800],
              indicators: {
                quote: [
                  {
                    open: [200.0, null, 205.0],
                    high: [205.0, null, 210.0],
                    low: [199.0, null, 204.0],
                    close: [204.0, null, 208.0],
                    volume: [500000, null, 600000],
                  },
                ],
              },
            },
          ],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockYahooResponse,
      } as any);

      const klines = await provider.getMarketData('MSFT', 'D', 10);
      expect(klines).toHaveLength(2);
      expect(klines[0].open).toBe(200.0);
      expect(klines[1].open).toBe(205.0);
    });

    it('extracts symbol info conforming to ISymbolInfo', async () => {
      const mockMetaResponse = {
        chart: {
          result: [
            {
              meta: {
                currency: 'USD',
                symbol: 'TSLA',
                exchangeName: 'NASDAQ',
                instrumentType: 'EQUITY',
                longName: 'Tesla, Inc.',
                exchangeTimezoneName: 'America/New_York',
                priceHint: 2,
              },
            },
          ],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetaResponse,
      } as any);

      const info = await provider.getSymbolInfo('TSLA');
      expect(info).toBeDefined();
      expect(info.ticker).toBe('TSLA');
      expect(info.currency).toBe('USD');
      expect(info.description).toBe('Tesla, Inc.');
      expect(info.type).toBe('equity');
      expect(info.pricescale).toBe(100);
      expect(info.mintick).toBe(0.01);
    });

    it('caches repeated getMarketData requests within cache duration', async () => {
      const mockYahooResponse = {
        chart: {
          result: [
            {
              timestamp: [1700000000],
              indicators: {
                quote: [{ open: [100], high: [105], low: [99], close: [104], volume: [1000] }],
              },
            },
          ],
        },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockYahooResponse,
      } as any);
      globalThis.fetch = fetchMock;

      await provider.getMarketData('GOOG', 'D', 5, 1700000000000, 1700086400000);
      await provider.getMarketData('GOOG', 'D', 5, 1700000000000, 1700086400000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('BinanceProvider Live WebSocket Streaming', () => {
    it('formats incoming trade events into normalized Tick objects', () => {
      const provider = new BinanceProvider();

      class MockWebSocket {
        public onopen: (() => void) | null = null;
        public onmessage: ((e: any) => void) | null = null;
        public onerror: ((e: any) => void) | null = null;
        public onclose: (() => void) | null = null;
        public closed = false;

        constructor(public url: string) {
          queueMicrotask(() => {
            if (this.onopen) this.onopen();
          });
        }

        close() {
          this.closed = true;
          if (this.onclose) this.onclose();
        }

        sendTrade(price: string, qty: string, timestamp: number) {
          if (this.onmessage) {
            this.onmessage({
              data: JSON.stringify({
                e: 'trade',
                E: timestamp,
                s: 'BTCUSDT',
                p: price,
                q: qty,
                T: timestamp,
              }),
            });
          }
        }
      }

      let activeWs: MockWebSocket | null = null;
      (globalThis as any).WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          activeWs = this;
        }
      };

      const receivedTicks: any[] = [];
      const cleanup = provider.subscribeLiveTicks('BTCUSDT', (tick) => {
        receivedTicks.push(tick);
      });

      expect(activeWs).not.toBeNull();
      expect(activeWs!.url).toContain('btcusdt@trade');

      activeWs!.sendTrade('67000.5', '0.25', 1700000100000);

      expect(receivedTicks).toHaveLength(1);
      expect(receivedTicks[0]).toEqual({
        price: 67000.5,
        volume: 0.25,
        time: 1700000100000,
      });

      cleanup();
      expect(activeWs!.closed).toBe(true);
    });
  });
});
