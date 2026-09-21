// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { ColumnarBarTable } from '@pineorca/data';

export interface MarketTick {
  price: number;
  volume: number;
  time: number;
}

const YAHOO_TIMEFRAME_MAP: Record<string, string> = {
  '1': '1m',
  '1m': '1m',
  '1M': '1m',
  '5': '5m',
  '5m': '5m',
  '5M': '5m',
  '15': '15m',
  '15m': '15m',
  '15M': '15m',
  '30': '30m',
  '30m': '30m',
  '30M': '30m',
  '60': '60m',
  '1h': '60m',
  '1H': '60m',
  '4h': '1d',
  '4H': '1d',
  '1d': '1d',
  '1D': '1d',
  D: '1d',
  W: '1wk',
  '1w': '1wk',
  M: '1mo',
};

const BINANCE_TIMEFRAME_MAP: Record<string, string> = {
  '1': '1m',
  '1m': '1m',
  '1M': '1m',
  '3': '3m',
  '3m': '3m',
  '3M': '3m',
  '5': '5m',
  '5m': '5m',
  '5M': '5m',
  '15': '15m',
  '15m': '15m',
  '15M': '15m',
  '30': '30m',
  '30m': '30m',
  '30M': '30m',
  '60': '1h',
  '1h': '1h',
  '1H': '1h',
  '120': '2h',
  '2h': '2h',
  '2H': '2h',
  '240': '4h',
  '4h': '4h',
  '4H': '4h',
  '1d': '1d',
  '1D': '1d',
  D: '1d',
  W: '1w',
  '1w': '1w',
  M: '1M',
};

export async function fetchBinanceKlines(
  symbol: string = 'BTCUSDT',
  timeframe: string = '60',
  limit: number = 1000,
): Promise<ColumnarBarTable | null> {
  const isFutures = symbol.toUpperCase().endsWith('.P');
  const cleanSymbol = isFutures ? symbol.slice(0, -2) : symbol;
  const baseUrl = isFutures ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
  const interval = BINANCE_TIMEFRAME_MAP[timeframe.toUpperCase()] || '1h';
  const url = `${baseUrl}/klines?symbol=${cleanSymbol.toUpperCase()}&interval=${interval}&limit=${limit}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const table = ColumnarBarTable.allocate(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      table.time[i] = Number(item[0]);
      table.open[i] = parseFloat(item[1]);
      table.high[i] = parseFloat(item[2]);
      table.low[i] = parseFloat(item[3]);
      table.close[i] = parseFloat(item[4]);
      table.volume[i] = parseFloat(item[5]);
    }
    return table;
  } catch (err) {
    console.warn(`[market-client] fetchBinanceKlines failed for ${symbol}:`, err);
    return null;
  }
}

export async function fetchYahooKlines(
  symbol: string,
  timeframe: string = '60',
  limit: number = 1000,
): Promise<ColumnarBarTable | null> {
  const interval = YAHOO_TIMEFRAME_MAP[timeframe.toUpperCase()] || '60m';
  const isBrowser = typeof window !== 'undefined';
  const baseUrl = isBrowser ? '/api/yahoo/v8/finance/chart' : 'https://query1.finance.yahoo.com/v8/finance/chart';
  const url = `${baseUrl}/${encodeURIComponent(symbol)}?interval=${interval}&range=1mo`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];
    if (!quote || timestamps.length === 0) return null;

    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const validIndices: number[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (opens[i] != null && closes[i] != null && highs[i] != null && lows[i] != null) {
        validIndices.push(i);
      }
    }

    if (validIndices.length === 0) return null;

    const finalIndices = limit && validIndices.length > limit ? validIndices.slice(-limit) : validIndices;
    const table = ColumnarBarTable.allocate(finalIndices.length);

    for (let i = 0; i < finalIndices.length; i++) {
      const srcIdx = finalIndices[i];
      table.time[i] = timestamps[srcIdx] * 1000;
      table.open[i] = Number(opens[srcIdx]);
      table.high[i] = Number(highs[srcIdx]);
      table.low[i] = Number(lows[srcIdx]);
      table.close[i] = Number(closes[srcIdx]);
      table.volume[i] = volumes[srcIdx] != null ? Number(volumes[srcIdx]) : 0;
    }

    return table;
  } catch (err) {
    console.warn(`[market-client] fetchYahooKlines failed for ${symbol}:`, err);
    return null;
  }
}

export function subscribeBinanceLiveTicks(
  symbol: string,
  onTick: (tick: MarketTick) => void,
  onError?: (err: any) => void,
): () => void {
  const isFutures = symbol.toUpperCase().endsWith('.P');
  const cleanSymbol = (isFutures ? symbol.slice(0, -2) : symbol).toLowerCase();
  const baseUrl = isFutures ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws';
  const url = `${baseUrl}/${cleanSymbol}@trade`;

  let ws: any = null;
  let isClosed = false;

  try {
    if (typeof WebSocket === 'undefined') {
      return () => {};
    }

    ws = new WebSocket(url);
    ws.onmessage = (event: any) => {
      if (isClosed) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString();
        const data = JSON.parse(raw);
        if (data && data.p && data.T) {
          onTick({
            price: parseFloat(data.p),
            volume: data.q ? parseFloat(data.q) : 0,
            time: Number(data.T) || Date.now(),
          });
        }
      } catch {
        // ignore malformed frame
      }
    };

    ws.onerror = (err: any) => {
      if (!isClosed && onError) onError(err);
    };
  } catch (err) {
    if (onError) onError(err);
  }

  return () => {
    isClosed = true;
    if (ws) {
      try {
        ws.close();
      } catch {}
      ws = null;
    }
  };
}
