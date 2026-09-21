---
phase: 1
title: "Yahoo Finance Provider Implementation"
status: completed
priority: P1
effort: "2.5h"
dependencies: []
---

# Phase 1: Yahoo Finance Provider Implementation

## Goal
Implement `YahooFinanceProvider` extending `BaseProvider` to ingest historical OHLCV data for equities, indices, and forex from Yahoo Finance Chart API v8, and register it in `Provider.class.ts`.

## Files to Create / Modify
- Create: `packages/engine-pinets/src/marketData/Yahoo/YahooFinanceProvider.class.ts`
- Modify: `packages/engine-pinets/src/marketData/Provider.class.ts`

## Tasks & Steps
1. **Define Config & Timeframe Mappings**:
   - `YahooFinanceProviderConfig` extending `BaseProviderConfig`: optional `baseUrl` (defaults to `'https://query1.finance.yahoo.com/v8/finance/chart'`) and optional `cacheDuration`.
   - Map canonical PineTS timeframes to Yahoo intervals:
     - `'1'` $\rightarrow$ `'1m'`
     - `'2'` $\rightarrow$ `'2m'`
     - `'5'` $\rightarrow$ `'5m'`
     - `'15'` $\rightarrow$ `'15m'`
     - `'30'` $\rightarrow$ `'30m'`
     - `'60'` / `'1h'` $\rightarrow$ `'60m'`
     - `'D'` / `'1D'` $\rightarrow$ `'1d'`
     - `'W'` / `'1W'` $\rightarrow$ `'1wk'`
     - `'M'` / `'1M'` $\rightarrow$ `'1mo'`
     - Return `null` for unsupported intervals (allowing `BaseProvider` to auto-aggregate from sub-timeframes).
2. **Implement `_getMarketDataNative`**:
   - Strip chart modifiers via `stripTickerModifier(tickerId)`.
   - Compute `period1` (start epoch seconds) and `period2` (end epoch seconds).
   - Fetch URL: `${baseUrl}/${tickerId}?period1=${period1}&period2=${period2}&interval=${interval}&includePrePost=false&events=div,splits`.
   - Include standard browser `User-Agent` in headers.
   - Parse JSON response: extract `chart.result[0].timestamp` and `chart.result[0].indicators.quote[0]`.
   - Filter out empty/null bars (holidays or non-trading slots).
   - Format each record into standard `Kline` interface (`open`, `high`, `low`, `close`, `volume`, `openTime`, `closeTime`).
   - Call `this.normalizeCloseTime(klines)` to ensure uniform interval alignment.
   - Cache results using `CacheManager`.
3. **Implement `getSymbolInfo`**:
   - Parse metadata from `chart.result[0].meta`: `currency`, `timezone`, `exchangeTimezoneName`, `instrumentType`, `regularMarketPrice`.
   - Return structured `ISymbolInfo` matching `packages/engine-pinets/src/marketData/IProvider.ts`.
4. **Register in `Provider.class.ts`**:
   - Export `YahooFinanceProvider`.
   - Instantiate `Provider.Yahoo = new YahooFinanceProvider()`.

## Verification
- Unit test verifying mock Yahoo JSON conversion to `Kline[]` with correct timestamp and OHLCV values.
- Node.js fetch test pulling 5 days of AAPL daily bars.
