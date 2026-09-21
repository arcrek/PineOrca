---
phase: 4
title: "Verification & Contract Tests"
status: completed
priority: P1
effort: "1.5h"
dependencies: [1, 2]
---

# Phase 4: Verification & Contract Tests

## Goal
Implement a comprehensive test suite in `packages/engine-pinets/test/` to validate schema conformity, time interval conversions, and error resilience for both Yahoo and Binance providers.

## Files to Create / Modify
- Create: `packages/engine-pinets/test/market-data-providers.test.ts`

## Tasks & Steps
1. **YahooFinanceProvider Unit Tests**:
   - Test JSON parsing of valid Yahoo response: assert `openTime`, `open`, `high`, `low`, `close`, `volume` are properly parsed numbers.
   - Test null-bar handling: ensure entries where quote values are `null` (market closures) are safely skipped without corrupting series alignment.
   - Test timeframe mappings: test `'1'`, `'5'`, `'60'`, `'D'`, `'W'`, `'M'`.
   - Test `getSymbolInfo()` output against `ISymbolInfo` contract.
2. **BinanceProvider Unit & Stream Tests**:
   - Test pagination logic: verify multiple 1000-bar chunks are merged correctly when date range requires >1000 candles.
   - Test cache behavior: verify repeat requests within TTL return cached data without extra network calls.
   - Test WebSocket message parsing: simulate Binance trade payload `{ p: "65000.5", q: "0.12", T: 1700000000000 }` and assert parsed `Tick`.
   - Test teardown: verify unsubscribe closes socket.
3. **Run Vitest**:
   - Execute vitest suite and ensure all tests pass cleanly.

## Verification
- Run: `npx vitest run packages/engine-pinets/test/market-data-providers.test.ts`
- Expected: All test cases pass with 0 failures.
