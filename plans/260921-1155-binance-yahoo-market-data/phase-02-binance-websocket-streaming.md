---
phase: 2
title: "Binance WebSocket Live Streaming"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 2: Binance WebSocket Live Streaming

## Goal
Enhance `BinanceProvider` with real-time WebSocket trade streaming (`@trade` / `@aggTrade`) to emit normalized `Tick` events directly into PineOrca's `LiveStreamingLoop`.

## Files to Create / Modify
- Modify: `packages/engine-pinets/src/marketData/Binance/BinanceProvider.class.ts`

## Tasks & Steps
1. **Define Streaming Interfaces & Signature**:
   - Import `Tick` from `../../streaming/LiveStreamingLoop`.
   - Add method signature:
     ```ts
     subscribeLiveTicks(
       tickerId: string,
       callback: (tick: Tick) => void,
       onError?: (err: any) => void
     ): () => void;
     ```
2. **WebSocket Endpoint Resolution**:
   - Determine spot vs futures: if `tickerId.endsWith('.P')`, use futures WebSocket base URL `wss://fstream.binance.com/ws/`, else spot `wss://stream.binance.com:9443/ws/`.
   - Format raw symbol: lowercase symbol without `.P` (e.g. `btcusdt@trade` or `btcusdt@aggTrade`).
3. **Connection Lifecycle & Auto-Reconnect**:
   - Instantiate native `WebSocket` (compatible with modern Node.js and browser runtimes).
   - Parse incoming trade message:
     ```ts
     // msg.p: price, msg.q: quantity, msg.T: trade timestamp
     const tick: Tick = {
       price: parseFloat(msg.p),
       volume: parseFloat(msg.q),
       time: msg.T,
     };
     ```
   - Implement graceful reconnect handling: on unexpected close or network error, attempt reconnect with bounded exponential backoff.
   - Return clean unsubscribe teardown function that closes the active socket and cancels any pending reconnect timers.

## Verification
- Unit test mocking WebSocket messages and asserting that `callback` receives properly typed `Tick` objects.
- Integration smoke test subscribing to `btcusdt` live stream for 2 seconds to receive real market ticks.
