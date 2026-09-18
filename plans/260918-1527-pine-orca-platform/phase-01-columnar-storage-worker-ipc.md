---
phase: 1
title: "High-Performance Columnar Storage & Worker IPC Subsystem"
status: completed
priority: P1
effort: "5d"
dependencies: []
---

# Phase 1: High-Performance Columnar Storage & Worker IPC Subsystem

## Goal
Establish a zero-copy, binary columnar data engine and an asynchronous, non-blocking Web Worker communication bridge capable of transferring 100,000 bars across threads in under 2ms with zero runtime GC overhead.

## Files to Create / Modify
- Create: `packages/data/src/columnar/ColumnarBarTable.ts` (Struct-of-arrays binary storage using `Float64Array`)
- Create: `packages/data/src/columnar/ColumnarBarStore.ts` (In-memory L1 cache with 64k-bar chunking and LRU eviction)
- Create: `packages/data/src/storage/IndexedDBStore.ts` (L2 persistent storage storing compressed chunks in IndexedDB)
- Create: `packages/data/src/feed/CachingDataFeed.ts` (Unified data provider orchestrating L1, L2, and REST/WS L3 feeds)
- Create: `packages/worker-bridge/src/protocol.ts` (Structured cloneable IPC message protocol and transferables)
- Create: `packages/worker-bridge/src/WorkerBridge.ts` (Main-thread typed RPC client managing Worker lifecycle and request multiplexing)
- Create: `packages/data/test/columnar-transfer.test.ts` (Transfer performance and layout unit tests)
- Create: `packages/data/test/indexeddb-store.test.ts` (Storage chunking and round-trip persistence tests)

## Tasks & Steps
1. **Binary Columnar Buffer Layout**:
   - Implement `ColumnarBarTable` packing `time`, `open`, `high`, `low`, `close`, and `volume` into continuous 64-byte aligned `Float64Array` buffers.
   - Support zero-copy slicing, appending, and buffer view transfers via `ArrayBuffer.transfer()` or transferable object arrays.
2. **L1 & L2 Caching Architecture**:
   - Implement `ColumnarBarStore` in-memory LRU cache holding hot OHLCV windows in memory.
   - Implement `IndexedDBStore` storing 1,000-bar binary chunks keyed by `${symbol}:${timeframe}:${chunkIndex}` to eliminate network re-fetching on page refresh.
   - Implement `CachingDataFeed` uniting local storage, memory caches, and external market data feeds (Binance, Coinbase, or custom REST/WebSocket).
3. **Asynchronous Web Worker Bridge**:
   - Implement `protocol.ts` defining typed command messages (`RUN_BACKTEST`, `STREAM_TICK`, `CANCEL_RUN`, `GET_SERIES_SLICE`) and response envelopes.
   - Build `WorkerBridge` with request-response multiplexing (`reqId`), transfer list management (`[buffer]`), and automatic worker health-check heartbeat.

## Verification
- `npx vitest run packages/data/test/columnar-transfer.test.ts --reporter=verbose`
  - *Pass criteria*: 100,000 bar allocation & transfer completes in $<2\text{ms}$ with zero heap allocation churn.
- `npx vitest run packages/data/test/indexeddb-store.test.ts`
  - *Pass criteria*: Chunk persistence, range queries, and binary buffer reconstruction round-trip without data corruption.
