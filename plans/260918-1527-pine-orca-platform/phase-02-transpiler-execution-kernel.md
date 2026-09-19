---
phase: 2
title: "Native Pine v5/v6 Transpiler & Core Execution Kernel"
status: complete
priority: P1
effort: "7d"
dependencies: ["1"]
---

# Phase 2: Native Pine v5/v6 Transpiler & Core Execution Kernel

## Goal
Integrate and harden the PineTS transpilation pipeline, bind the execution context directly to continuous columnar buffers via `FastSeries`, and implement synchronous hot-loop execution for maximum backtest throughput.

## Files to Create / Modify
- Create: `packages/engine-pinets/src/transpiler/PineTranspiler.ts` (AST transformer compiling Pine v5/v6 to optimized JS)
- Create: `packages/engine-pinets/src/transpiler/ScopeManager.ts` (Variable isolation, unique call ID generation, AST callsite IDs)
- Create: `packages/engine-pinets/src/core/FastSeries.ts` (O(1) reverse-indexed series wrapper over `Float64Array`)
- Create: `packages/engine-pinets/src/core/PineContext.ts` (Execution context holding built-in series and runtime namespaces)
- Create: `packages/engine-pinets/src/namespaces/ta/TaLib.ts` (Vectorized and incremental technical analysis indicators)
- Create: `packages/engine-pinets/src/worker/worker.ts` (Web Worker entrypoint listening to `WorkerBridge` commands)
- Create: `packages/engine-pinets/test/transpiler.test.ts` (Pine v5 and v6 compilation test suite)
- Create: `packages/engine-pinets/test/fast-series.benchmark.ts` (Lookback indexing performance benchmark)

## Tasks & Steps
1. **Transpiler Integration & Call Site Tagging**:
   - Integrate PineTS lexer, parser, and AST code generator (`/tmp/PineTS/src/transpiler`).
   - Enhance `ScopeManager` to inject stable AST callsite IDs (`__callsiteId`) at compile time into `plotshape`, `plotchar`, and `plotarrow`, eliminating the need for runtime monkey patching.
   - Implement static AST pre-resolution for `request.security`: pre-scan Pine source for external resolution requests, fetch secondary series prior to the loop, and compile the bar execution function into a synchronous function (`_executeIterationsSync`).
2. **Columnar FastSeries Implementation**:
   - Implement `FastSeries` wrapping `Float64Array` buffers to provide $O(1)$ reverse indexing: `get(offset)` resolves to `buffer[currentIndex - Math.trunc(offset)]`.
   - Ensure out-of-bounds lookbacks return `NaN` conforming to Pine Script semantics.
   - Bind `context.data.open`, `high`, `low`, `close`, and `volume` directly to `FastSeries` without object-array wrappers.
3. **Incremental Technical Analysis Library (`ta.*`)**:
   - Port 60+ technical indicators (`ta.sma`, `ta.ema`, `ta.rsi`, `ta.macd`, `ta.bb`, `ta.atr`) using incremental accumulator states.
   - Isolate calculation state across distinct indicator instances using transpiler-generated `_callId`.

## Verification
- `npx vitest run packages/engine-pinets/test/transpiler.test.ts`
  - *Pass criteria*: 100% of canonical Pine v5 and v6 indicator fixtures transpile and execute without syntax errors.
- `npx vitest run packages/engine-pinets/test/fast-series.benchmark.ts`
  - *Pass criteria*: `FastSeries.get()` throughput exceeds 5,000,000 lookbacks/sec on 100,000 bars.
