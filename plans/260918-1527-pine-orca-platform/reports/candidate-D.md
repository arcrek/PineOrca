# PineOrca Implementation Plan: Ultra Verifier Candidate D
**High-Performance Browser-First Pine Script v5/v6 Execution, TV Broker Parity Backtesting & Modular WebGL2 UI Platform**

---

## 1. Executive Summary & Architecture Overview

PineOrca is an institutional-grade, browser-native quantitative platform designed to execute Pine Script v5/v6 with 1:1 TradingView syntax and execution parity. The platform unites three core pillars:
1. **High-Performance Transpiler & Runtime Engine**: Off-thread compilation and execution of Pine Script into optimized, JIT-friendly JavaScript running in dedicated Web Workers, featuring synchronous loop unrolling and zero-allocation columnar buffers.
2. **Realistic Backtesting Engine & Broker Emulator**: Bit-accurate order matching replicating TradingView's two-phase fill model (gap fills at open, intrabar crossings), intrabar polarity heuristics (`isAdverseFirstBar`), multi-lot FIFO liquidation, margin call checkpoints, and comprehensive risk metrics.
3. **TradingView-Grade UI & Strategy Tester**: WebGL2 multi-pane charting powered by Vela, on-chart `TradeExecution` markers, dockable bottom panel hosting an interactive Strategy Tester (dual-canvas equity curves, 24-metric performance breakdown, virtualized 60fps trade list), and an embedded Monaco Pine v5/v6 IDE with live diagnostics.

### 1.1 System Component Topology

```
+----------------------------------------------------------------------------------------------------+
|                                    BROWSER MAIN THREAD (Apache-2.0 / MIT)                          |
|                                                                                                    |
|  +-----------------------------------------------------------------------------------------------+  |
|  |                                  VelaWorkspace (Vela Shell)                                   |  |
|  |  +---------------------------------------------------+  +----------------------------------+  |  |
|  |  |            Vela WebGL2 / Canvas2D Chart           |  |      PanelDock (Side Panels)     |  |  |
|  |  |  - Price Pane (Candles, In-Chart Trade Markers)    |  |  - Object Tree                  |  |  |
|  |  |  - Sub-Panes (RSI, MACD, Stochastic Indicators)   |  |  - Data Window                  |  |  |
|  |  |  - Drawing Layer (Lines, Boxes, Labels, Tables)   |  |  - Indicator / Symbol Pickers   |  |  |
|  |  +---------------------------------------------------+  +----------------------------------+  |  |
|  |  |                        Horizontal Splitter (Draggable Divider)                         |  |  |
|  |  +-----------------------------------------------------------------------------------------+  |  |
|  |  |                              VelaBottomDock (Bottom Panel)                              |  |  |
|  |  |  +--------------------------+  +--------------------------+  +-----------------------+  |  |  |
|  |  |  |   Strategy Tester Tab    |  |     Pine Editor Tab      |  | Pine Logs / Console   |  |  |  |
|  |  |  |  - Overview (Equity/DD) |  |  - Monaco Pine Grammar   |  |  - Engine Warnings    |  |  |  |
|  |  |  |  - Performance Summary   |  |  - AST Diagnostic Linter |  |  - User log.info()    |  |  |  |
|  |  |  |  - Virtualized TradeList|  |  - "Add/Update to Chart"  |  |  - Margin Alerts      |  |  |  |
|  |  |  +--------------------------+  +--------------------------+  +-----------------------+  |  |  |
|  |  +-----------------------------------------------------------------------------------------+  |  |
|  |  |                        Bottombar (Presets, Timeframe, Status)                           |  |  |
|  +--+-----------------------------------------------------------------------------------------+--+  |
|                                                  |                                                  |
|                       Abstract ScriptingEngine Interface (plugin.ts)                               |
|                                                  |                                                  |
|                                     PineWorkerEngine Proxy                                          |
|                               (Main-to-Worker IPC Orchestrator)                                     |
+--------------------------------------------------+-------------------------------------------------+
                                                   |
                             Structured Clone / Transferable ArrayBuffers
                                  (postMessage IPC Protocol)
                                                   |
+--------------------------------------------------v-------------------------------------------------+
|                                 DEDICATED WEB WORKER THREAD (AGPL-3.0)                              |
|                                                                                                    |
|  +-----------------------------------------------------------------------------------------------+  |
|  |                                      worker.ts Worker Loop                                    |  |
|  |  +-----------------------------+  +--------------------------------------------------------+  |  |
|  |  |  Transpiler Pipeline        |  |  PineTS Runtime Engine                                 |  |  |
|  |  |  - Pine Lexer / Parser      |  |  - Context / Series Cursor Buffer (Zero Allocations)   |  |  |
|  |  |  - AST Async Analyzer       |  |  - Sync Loop Unroller (_executeIterationsSync)         |  |  |
|  |  |  - JS Code Generator        |  |  - Stateful TA Library (ta.sma, ta.ema, ta.rsi)        |  |  |
|  |  +-----------------------------+  +--------------------------------------------------------+  |  |
|  |                                   |  TV Broker Emulator (strategy/utils.ts)                |  |  |
|  |                                   |  - Two-Phase Fill Engine (Open Gaps vs Intrabar Bounds)|  |  |
|  |                                   |  - Polarity Path Heuristics (isAdverseFirstBar)        |  |  |
|  |                                   |  - FIFO Lot Splitting & Multi-Bracket OCA Exits        |  |  |
|  |                                   |  - 3-Point Margin Call Checkpoints                     |  |  |
|  |                                   |  - Metrics: CAGR, Sharpe, Sortino, Underwater DD       |  |  |
|  |                                   +--------------------------------------------------------+  |  |
|  |                                   |  toScene Translator                                    |  |  |
|  |                                   |  - IndicatorModel & TradeExecution Generation          |  |  |
|  |                                   |  - Enriched StrategyState Serializer                   |  |  |
|  +-----------------------------------+--------------------------------------------------------+--+  |
+----------------------------------------------------------------------------------------------------+
```

### 1.2 Data Flow & Execution Lifecycle

1. **Script Ingestion & Parsing**: The user opens or edits a script in the Monaco Pine Editor. A debounced event (300ms) triggers `PineWorkerEngine.prepare(source)`. The Web Worker parses the code into an AST and returns compiler diagnostics or input metadata (`InputSchema[]`) without executing historical bars.
2. **Execution Initialization**: When attached to a chart, the main thread sends `runSession` with bar data (`OHLCV[]`) transferred as contiguous `Float64Array` buffers.
3. **Optimized Loop Execution**:
   - The worker's AST analyzer verifies if the script contains asynchronous operations (such as `request.security` or `request.security_lower_tf`).
   - If purely synchronous (standard case), it invokes `_executeIterationsSync`: historical bars loop synchronously with zero Promise/microtask overhead, advancing an internal bar index cursor over pre-allocated memory.
   - If MTF calls exist, the execution enters `_executeIterationsAsync`, yielding back to the main thread via `{ kind: 'fetchSeries', reqId, symbol, timeframe, range }` and awaiting resolution before continuing.
4. **Broker Emulation & Order Settlement**: At each bar iteration, `processExitOrders('open')` resolves gap-fills, followed by pending order entries, intrabar limit/stop executions according to `isAdverseFirstBar`, bracket exits, margin call checkpoints, and cumulative equity tracking.
5. **Scene Translation & UI Hydration**: On completion, `toScene` maps indicator plots, drawings (lines, boxes, tables), and `TradeExecution[]` markers. The worker packages the neutral `IndicatorModel`, the full `StrategyState`, the closed/open trades array, and the Float64Array equity curve, returning them to the main thread.
6. **Parallel Viewport Update**:
   - Vela's WebGL2 engine draws candlestick series and indicator lines across panes.
   - `TradeMarkersRenderer` overlays buy/sell arrows and price ticks on the price pane.
   - The Strategy Tester receives the enriched payload, updating metric summary cards, rendering the dual-canvas equity/drawdown curve, and hydrating the virtualized trade table.

---

## 2. Phased Implementation Roadmap

### Phase 1: PineTS Synchronous Loop Unrolling & Zero-Copy Series Optimization
**Goal**: Eliminate microtask scheduling latency in historical bar execution, transition from per-bar `Array.push()` allocations to cursor-based typed buffers, and achieve sub-5ms backtests on 10,000 bars.

- **Files to Modify/Create**:
  - Modify: `/tmp/PineTS/src/PineTS.class.ts` (cite: lines 1140-1220)
  - Modify: `/tmp/PineTS/src/transpiler/transformers/WrapperTransformer.ts` (cite: lines 55-81)
  - Modify: `/tmp/PineTS/src/transpiler/transformers/MainTransformer.ts` (cite: lines 20-100)
  - Modify: `/tmp/PineTS/src/Series.ts` (cite: lines 1-50)
  - Create: `/tmp/PineTS/src/core/CursorSeries.ts`
  - Create: `/tmp/PineTS/tests/perf/sync-loop-benchmark.test.ts`

- **Step-by-Step Implementation Tasks**:
  1. *AST Async Analysis*: In `WrapperTransformer.ts`, inspect the AST body for `AwaitExpression` or calls to `request.security`, `request.security_lower_tf`. If no async dependencies exist, wrap the generated JS body in `(context) => { ... }` instead of `async (context) => { ... }`.
  2. *Dual Execution Paths in `PineTS.class.ts`*:
     - Retain `_executeIterationsAsync` for scripts requiring dynamic data requests.
     - Implement `_executeIterationsSync(context: Context, transpiledFn: Function, startIdx: number, endIdx: number): void`. Replace `await transpiledFn(context)` with direct synchronous invocation `transpiledFn(context)`.
  3. *Zero-Allocation Columnar Storage (`CursorSeries`)*:
     - Replace dynamic 12-array push operations per bar (`context.data.open.data.push(...)`) with pre-allocated contiguous `Float64Array` buffers for OHLCV.
     - Add `cursor` property to `Context.data`. `Series.get(offset)` resolves directly as `this.buffer[context.cursor - offset]` in $O(1)$ time without memory allocations or array resizes.
  4. *Benchmarking & Memory Profile*: Build a high-bar benchmark testing 10k, 50k, and 100k bars comparing pre- and post-optimization execution times and heap allocations.

- **Concrete Verification Commands**:
  ```bash
  cd /tmp/PineTS && npx vitest run tests/perf/sync-loop-benchmark.test.ts
  cd /tmp/PineTS && npx vitest run tests/transpiler/pine-to-js.test.ts
  node -e "
    const { PineTS } = require('./dist/pinets.min.cjs');
    const pine = new PineTS();
    const bars = Array.from({length: 10000}, (_, i) => ({
      openTime: i * 60000, open: 100 + (i%10), high: 105 + (i%10), low: 95 + (i%10), close: 102 + (i%10), volume: 1000
    }));
    const t0 = performance.now();
    pine.run('//@version=5\nindicator(\"FastSMA\")\nsma20 = ta.sma(close, 20)\nplot(sma20)', bars);
    console.log('10k bars execution latency:', (performance.now() - t0).toFixed(2), 'ms (Target < 5ms)');
  "
  ```

---

### Phase 2: Web Worker Off-Threading, Zero-Copy IPC & Streaming Engine
**Goal**: Isolate PineTS execution entirely off the UI thread inside a dedicated Web Worker bundle, transfer market data using zero-copy Transferable ArrayBuffers, and support asynchronous multi-timeframe data fetching.

- **Files to Modify/Create**:
  - Modify: `/tmp/Vela-pinets/src/pinets-worker/protocol.ts` (cite: lines 19-46)
  - Modify: `/tmp/Vela-pinets/src/pinets-worker/worker.ts` (cite: lines 20-147)
  - Modify: `/tmp/Vela-pinets/src/pinets-worker/PineWorkerEngine.ts` (cite: lines 10-125)
  - Create: `/tmp/Vela-pinets/src/pinets-worker/bufferTransfer.ts`
  - Modify: `/tmp/Vela-pinets/test/pine-worker-engine.test.ts`
  - Create: `/tmp/Vela-pinets/test/worker-mtf-fetch.test.ts`

- **Step-by-Step Implementation Tasks**:
  1. *Protocol Definition Extension*:
     - In `protocol.ts`, expand `MainToWorker` to support `runSessionWithBuffers`: `{ kind: 'runBuffers', sessionId: number, openTime: ArrayBuffer, open: ArrayBuffer, high: ArrayBuffer, low: ArrayBuffer, close: ArrayBuffer, volume: ArrayBuffer, length: number }`.
     - Expand `WorkerToMain` to return enriched strategy payloads: `{ kind: 'strategyResult', sessionId: number, state: FullStrategyState, trades: FullStrategyTrade[], equityCurve: ArrayBuffer }`.
  2. *Worker Script Isolation*:
     - Update `worker.ts` to deserialize Transferable ArrayBuffers directly into typed `Float64Array` views for PineTS `CursorSeries`.
     - Implement request-response multiplexing for `request.security`: When the transpiled script triggers a secondary resolution, the worker suspends execution, dispatches `{ kind: 'fetchSeries', reqId, symbol, timeframe, range }`, and resumes upon receiving `{ kind: 'fetchSeriesResult', reqId, bars }`.
  3. *Cancellation & Lifecycle Management*:
     - Implement immediate execution preemption via `AbortController` and Worker worker pool recycling when rapid user interactions (symbol change, slider drags, code typing) occur.
  4. *Live Tick Ingestion Pipeline*:
     - Implement `{ kind: 'appendTick', sessionId: number, bar: OHLCV, isBarClosed: boolean }` allowing single-bar recalculation on live WebSocket feeds without historical re-runs.

- **Concrete Verification Commands**:
  ```bash
  cd /tmp/Vela-pinets && npx vitest run test/pine-worker-engine.test.ts
  cd /tmp/Vela-pinets && npx vitest run test/worker-mtf-fetch.test.ts
  node -e "
    const { PineWorkerEngine } = require('./dist/index.js');
    console.log('Worker engine successfully boots and initializes proxy communication.');
  "
  ```

---

### Phase 3: TradingView Broker Parity, Multi-Lot FIFO & Metric Engine
**Goal**: Match TradingView's backtesting broker emulator on order precedence, intrabar path ambiguity, bracket executions, margin requirements, and comprehensive strategy reporting metrics.

- **Files to Modify/Create**:
  - Modify: `/tmp/PineTS/src/namespaces/strategy/utils.ts` (cite: lines 200-380, 842-930, 1223-1320, 1745-1912, 1970-2050)
  - Modify: `/tmp/PineTS/src/namespaces/strategy/types.ts` (cite: lines 48-83)
  - Modify: `/tmp/Vela-pinets/src/pinets/strategyState.ts` (cite: lines 33-93)
  - Create: `/tmp/PineTS/src/namespaces/strategy/metrics.ts`
  - Create: `/tmp/PineTS/tests/strategy/tv-broker-parity.test.ts`
  - Create: `/tmp/PineTS/tests/strategy/margin-call-checkpoints.test.ts`

- **Step-by-Step Implementation Tasks**:
  1. *Two-Phase Bar Execution*:
     - Verify and lock `processExitOrders(context, 'open')` running before any new entry fills on the current bar. Orders gapping beyond stop/limit triggers at market open execute at `openPrice`.
     - Run entry orders at `openPrice` (market) or wait for intrabar price movement (limit/stop).
  2. *Intrabar Polarity Heuristic (`isAdverseFirstBar`)*:
     - In `utils.ts:1747`, strictly calculate price trajectory:
       If $|open - high| \le |open - low|$, price visits High first, then Low (Bullish Wick Trajectory: $Open \rightarrow High \rightarrow Low \rightarrow Close$).
       If $|open - high| > |open - low|$, price visits Low first, then High (Bearish Wick Trajectory: $Open \rightarrow Low \rightarrow High \rightarrow Close$).
     - Long entries treat Low as adverse; short entries treat High as adverse. If both Stop Loss and Take Profit fall within the bar's High-Low range, the adverse extreme triggers first if `isAdverseFirstBar` is true.
  3. *Multi-Lot FIFO Liquidation with Bracket Tracking*:
     - In `closePartialPosition` (`utils.ts:842`), ensure multi-lot orders match against the oldest open entries in the FIFO queue.
     - Preserve physical lot entry price `_bracket_entry` across partial fills to ensure subsequent bracket limits and trailing stops calculate from the correct basis.
  4. *Multi-Checkpoint Margin Call Engine*:
     - Execute margin evaluations at three distinct stages: (1) `open` (post-open fills), (2) `extreme` (at the adverse intrabar price), and (3) `close`.
     - When $HeldMargin > AvailableEquity$, execute forced liquidation at the adverse price point, logging the margin call event in the ledger.
  5. *Complete TradingView Metrics Module*:
     - In `metrics.ts`, compute:
       - Realized P&L: Net Profit, Gross Profit, Gross Loss, Profit Factor ($GrossProfit / GrossLoss$).
       - Trade Statistics: Total Trades, Winning Trades, Losing Trades, Win Rate %, Avg Trade, Avg Win, Avg Loss, Win/Loss Ratio.
       - Drawdown: Max Drawdown ($ and %), Intrabar Peak Adverse Excursion vs Closed-Trade Drawdown, Max Run-Up.
       - Time-Series Metrics: Sharpe Ratio, Sortino Ratio, CAGR, Buy & Hold Return.
  6. *Bridge Layer Enrichment*:
     - Extend `toStrategyTrades` in `/tmp/Vela-pinets/src/pinets/strategyState.ts` to output all trade attributes: `profit`, `profitPercent`, `cumEquity`, `runup`, `drawdown`, `barsHeld`, `entryPrice`, `exitPrice`, `entryTime`, `exitTime`.

- **Concrete Verification Commands**:
  ```bash
  cd /tmp/PineTS && npx vitest run tests/strategy/tv-broker-parity.test.ts
  cd /tmp/PineTS && npx vitest run tests/strategy/margin-call-checkpoints.test.ts
  cd /tmp/PineTS && npx vitest run tests/strategy/fifo-execution.test.ts
  ```

---

### Phase 4: Dockable Workspace Shell & Monaco Pine Script Editor
**Goal**: Integrate a resizable bottom dock into VelaWorkspace and build a Monaco Pine Script v5/v6 editor with syntax highlighting, autocomplete, and live compiler diagnostics.

- **Files to Modify/Create**:
  - Modify: `/tmp/Vela/src/workspace/VelaWorkspace.ts` (cite: lines 150-196)
  - Create: `/tmp/Vela/src/widget/bottom-dock.ts`
  - Create: `/tmp/Vela/src/editor/monaco-pine.ts`
  - Create: `/tmp/Vela/src/editor/pine-grammar.ts`
  - Create: `/tmp/Vela/src/editor/pine-completions.ts`
  - Create: `/tmp/Vela/src/editor/pine-diagnostics.ts`
  - Create: `/tmp/Vela/test/bottom-dock.test.ts`

- **Step-by-Step Implementation Tasks**:
  1. *Vela Bottom Dock Integration*:
     - In `VelaWorkspace.ts`, inject `VelaBottomDock` between `.vela-ws-main` and `Bottombar`.
     - Utilize pure splitter math from `/tmp/Vela/src/workspace/splitters.ts` (`resizeTracks`) to support smooth dragging, minimizing, and maximizing of the bottom panel.
     - Implement panel tab switching: `Strategy Tester`, `Pine Editor`, `Console`.
  2. *Monaco Pine Language Definition (`pine-grammar.ts`)*:
     - Register `monaco.languages.register({ id: 'pine' })`.
     - Define Monarch tokenizer rules for Pine v5/v6:
       - Keywords: `if`, `else`, `for`, `to`, `by`, `while`, `switch`, `type`, `method`, `export`, `import`, `var`, `varip`.
       - Types: `int`, `float`, `bool`, `string`, `color`, `line`, `box`, `label`, `table`, `matrix`, `map`.
       - Namespaces: `ta`, `strategy`, `request`, `math`, `color`, `plot`, `hline`, `line`, `box`, `table`.
       - Builtins: `open`, `high`, `low`, `close`, `volume`, `time`, `bar_index`.
  3. *Autocomplete & Signature Help (`pine-completions.ts`)*:
     - Register `CompletionItemProvider` offering full signatures, parameter types, and docstrings for all `ta.*` and `strategy.*` methods extracted directly from PineTS AST definitions.
  4. *Live Diagnostic Markers (`pine-diagnostics.ts`)*:
     - Listen to Monaco `onDidChangeModelContent` (debounced 300ms).
     - Send source to worker via `PineWorkerEngine.prepare(source)`.
     - Map syntax or type errors directly to `monaco.editor.setModelMarkers` with line numbers, columns, and error messages.
  5. *Editor Toolbar Controls*:
     - Provide buttons for: "Add to Chart" / "Update on Chart" (instantly updates active Vela chart session), "Save Script" (local storage persistence), "New Strategy Template".

- **Concrete Verification Commands**:
  ```bash
  cd /tmp/Vela && npx vitest run test/bottom-dock.test.ts
  cd /tmp/Vela && npx vitest run test/editor-monaco.test.ts
  ```

---

### Phase 5: High-Performance Strategy Tester UI (Overview, Summary, Virtualized Trades)
**Goal**: Deliver a TradingView-style Strategy Tester featuring an interactive dual-canvas equity/drawdown curve with crosshair sync, a 24-metric performance summary table, and a virtualized 60fps trade list with chart jump-to-bar navigation.

- **Files to Modify/Create**:
  - Create: `/tmp/Vela/src/widget/strategy-tester/StrategyTester.ts`
  - Create: `/tmp/Vela/src/widget/strategy-tester/OverviewTab.ts`
  - Create: `/tmp/Vela/src/widget/strategy-tester/EquityCurveCanvas.ts`
  - Create: `/tmp/Vela/src/widget/strategy-tester/PerformanceSummaryTab.ts`
  - Create: `/tmp/Vela/src/widget/strategy-tester/TradeListTab.ts`
  - Create: `/tmp/Vela/src/widget/strategy-tester/VirtualizedTable.ts`
  - Create: `/tmp/Vela/test/strategy-tester-ui.test.ts`
  - Create: `/tmp/Vela/test/virtualized-table.test.ts`

- **Step-by-Step Implementation Tasks**:
  1. *Overview Tab & Dual Canvas Engine (`EquityCurveCanvas.ts`)*:
     - Build a high-performance Canvas2D renderer displaying:
       - Upper Chart: Cumulative Equity curve ($) plotted alongside Buy & Hold benchmark.
       - Lower Chart: Underwater Drawdown area chart with translucent red fill (`rgba(242, 54, 69, 0.25)`).
     - Crosshair synchronization: Hovering over the equity curve draws a synchronized time cursor and fires `vela.setCrosshairTime(time)`, highlighting the exact candlestick on the price chart.
  2. *Summary KPI Metric Tiles*:
     - Display top-level cards: Net Profit ($ and %), Profit Factor, Percent Profitable (Win Rate %), Total Trades, Max Drawdown ($ and %), Sharpe Ratio, Sortino Ratio.
  3. *Performance Summary Grid (`PerformanceSummaryTab.ts`)*:
     - Render TradingView's 3-column table format (`All Trades`, `Long Trades`, `Short Trades`) covering:
       - Net Profit, Gross Profit, Gross Loss, Profit Factor.
       - Total Closed Trades, Winning Trades, Losing Trades, Win Rate %.
       - Average Trade, Average Winning Trade, Average Losing Trade, Win/Loss Ratio.
       - Largest Winning Trade, Largest Losing Trade.
       - Max Consecutive Wins, Max Consecutive Losses.
       - Max Contracts / Size Held, Margin Calls Count.
       - Max Drawdown (closed-to-closed and intrabar peak), Max Run-Up.
       - Sharpe Ratio, Sortino Ratio, CAGR %, Buy & Hold Return.
  4. *Virtualized Trade List (`VirtualizedTable.ts` & `TradeListTab.ts`)*:
     - Implement DOM virtualization rendering only visible rows (viewport capacity ~25-30 rows + 5-row overscan buffer). Handles 50,000+ trades at 60fps with constant DOM node count.
     - Columns: Trade #, Type (Entry/Exit Long/Short), Signal/Comment, Date/Time, Price, Size, Profit ($), Profit (%), Cumulative Equity, Run-up, Drawdown.
     - Interactive Row Selection: Clicking any trade row triggers `vela.scrollTimeToCenter(trade.time)` and pulses the matching `TradeExecution` arrow on the price pane.
     - Sorting & Filtering: Sort by any column header; filter by Trade Type (All, Long Only, Short Only) and Outcome (Wins Only, Losses Only).
     - Export to CSV: Download full backtest trade ledger as standard CSV.

- **Concrete Verification Commands**:
  ```bash
  cd /tmp/Vela && npx vitest run test/strategy-tester-ui.test.ts
  cd /tmp/Vela && npx vitest run test/virtualized-table.test.ts
  ```

---

### Phase 6: TV Reference Test Matrix, Benchmarks & AGPL Licensing Hardening
**Goal**: Validate PineOrca against TradingView golden reference outputs, execute automated stress suites, and enforce process isolation to prevent AGPL copyleft contamination of UI code.

- **Files to Modify/Create**:
  - Create: `/tmp/PineTS/tests/parity/reference-strategies.test.ts`
  - Create: `/tmp/PineTS/tests/parity/fixtures/tv-golden-results.json`
  - Create: `/tmp/PineTS/tests/parity/fixtures/tv-ohlcv-btc-1h.json`
  - Create: `/tmp/PineTS/tests/parity/fixtures/tv-ohlcv-aapl-1d.json`
  - Create: `/tmp/Vela-pinets/scripts/verify-licensing-boundary.sh`
  - Modify: `/tmp/Vela/package.json`

- **Step-by-Step Implementation Tasks**:
  1. *Golden Reference Test Suite*:
     - Execute 5 standard reference strategies on identical OHLCV feeds (10,000 bars BTC/USDT 1h, AAPL 1d):
       1. SMA Crossover Strategy (fast=10, slow=50).
       2. Supertrend Strategy (ATR=10, factor=3.0).
       3. RSI Mean Reversion with Bollinger Band Exits.
       4. Multi-Bracket Grid Strategy with OCA groups (`strategy.exit` stop/limit).
       5. Intrabar Scalping Strategy with tight stops and margin limits.
     - Assert that Net Profit, Total Trades, Win Rate, and Max Drawdown match TradingView golden export CSVs within a 0.01% float epsilon.
  2. *Licensing Boundary Verification*:
     - Run AST bundle scanner verifying that no AGPL-3.0 source or package dependency is bundled into `@luxalgo/vela` or main-thread UI components.
     - Ensure all PineTS engine imports reside strictly inside the isolated Worker bundle (`pinets-worker.js`), communicated with exclusively via `postMessage`.
  3. *CI/CD Automation Pipeline*:
     - Integrate end-to-end Vitest test runners and bundle size checkers.

- **Concrete Verification Commands**:
  ```bash
  cd /tmp/PineTS && npx vitest run tests/parity/reference-strategies.test.ts
  bash /tmp/Vela-pinets/scripts/verify-licensing-boundary.sh
  ```

---

## 3. Detailed Backtesting & Broker Parity Specifications

### 3.1 Order Execution Timeline & Precedence (Two-Phase Model)

TradingView does not execute orders instantaneously; it follows a rigorous sequence at each bar transition:

```
BAR N CLOSE ---> BAR N+1 OPEN (Tick 0) -----------------------------------> INTRABAR TICKS ------------> BAR N+1 CLOSE
                     |                                                           |                            |
      1. Phase 'open' Exits (Gap Fills)                           4. Intrabar Bracket Exits       7. Mark-to-Market Close
         - Pending stop/limit orders where                           - Trailing stops              8. Equity Accounting
           openPrice opened beyond trigger                           - Take Profit limits          9. Next Bar Orders Queued
         - Filled at openPrice!                                      - Stop Loss stops
                     |                                                           |
      2. Pending Entry Fills                                      5. Intrabar Pending Entries
         - Market orders fill at openPrice                           - Limit orders fill if
         - Directional margin check applied                            High/Low crosses price
                     |                                                           |
      3. Margin Call Checkpoint 1 ('open')                        6. Margin Call Checkpoint 2 ('extreme')
         - Check equity post-open fills                              - Adverse extreme evaluation
```

- **Gap-Fill Logic (Phase 'open')**:
  In `/tmp/PineTS/src/namespaces/strategy/utils.ts:1235`, `processExitOrders(context, 'open')` runs *before* any entry orders. If a long position has a Stop Loss at $100, and the bar opens at $95 (a downward gap):
  - Standard backtesters incorrectly fill at the stop price ($100).
  - PineOrca fills at the actual open price ($95), accurately reflecting slippage and market realities.

### 3.2 Intrabar Price Polarity & Wick Trajectory (`isAdverseFirstBar`)

When a bar contains both a Stop Loss trigger and a Take Profit trigger, the execution order depends on which price was reached first. Without tick data, PineOrca uses TradingView's exact geometric wick heuristic (`utils.ts:1747`):

$$\text{openCloserToHigh} = |High - Open| \le |Open - Low|$$

- **Bullish Bar / High First** ($\text{openCloserToHigh} = \text{true}$):
  Assumed price path: $Open \rightarrow High \rightarrow Low \rightarrow Close$.
- **Bearish Bar / Low First** ($\text{openCloserToHigh} = \text{false}$):
  Assumed price path: $Open \rightarrow Low \rightarrow High \rightarrow Close$.

For a **Long Position**:
- Low is the **adverse** extreme (Stop Loss / Liquidation).
- High is the **favorable** extreme (Take Profit).
- If $\text{openCloserToHigh}$ is false, Low is visited *first*: **Stop Loss triggers before Take Profit**, matching TradingView's conservative broker simulation.

### 3.3 Multi-Lot FIFO Liquidation & Entry Splitting

When pyramiding is enabled, multiple entries create independent lots. PineOrca adheres to TradingView's FIFO ledger pairing:
1. When `strategy.close` or `strategy.exit` closes a partial quantity, the engine consumes lots strictly in FIFO order (`utils.ts:848`).
2. If an exit closes $7.5$ contracts while the oldest open lot is $5.0$ contracts, the engine splits the exit into two ledger records:
   - Record 1: Closes $5.0$ contracts against Lot 1.
   - Record 2: Closes $2.5$ contracts against Lot 2.
3. Each record receives its individual entry price, commission charge, and realized P&L.
4. The physical entry price (`_bracket_entry`) is retained on remaining open lots so trailing stop brackets remain pegged to the correct entry basis.

### 3.4 Margin Call Evaluation & Liquidation Rules

PineOrca implements 3-point margin checks per bar (`utils.ts:1790`):
1. **Formula**:
   $$\text{RequiredMargin} = \frac{|PositionSize| \times Price \times PointValue \times MarginPct}{100}$$
   $$\text{AvailableEquity} = \text{Equity} - \text{HeldMargin}$$
2. **Evaluation Checkpoints**:
   - `open`: Evaluated immediately after Phase 'open' orders execute.
   - `extreme`: Evaluated at the bar's adverse extreme (Low for longs, High for shorts).
   - `close`: Evaluated at the bar's closing price.
3. **Liquidation Action**: If $\text{AvailableEquity} < 0$, a forced liquidation order closes the position at the violation price, logging an account margin call event.

### 3.5 Complete Performance Metrics Matrix

| Metric Name | Calculation Method | TradingView Parity Definition |
| :--- | :--- | :--- |
| **Net Profit** | $\sum \text{Realized P\&L} - \sum \text{Commissions}$ | Total dollar gain/loss after all fees |
| **Gross Profit** | $\sum \text{Profits of all winning trades}$ | Sum of positive trade profits |
| **Gross Loss** | $\sum |\text{Losses of all losing trades}|$ | Sum of absolute negative trade losses |
| **Profit Factor** | $\frac{\text{Gross Profit}}{\text{Gross Loss}}$ | Ratio of total profit to total loss ($\infty$ if loss=0) |
| **Total Closed Trades** | Count of closed trade round-trips | Total completed trades |
| **Win Rate (%)** | $\frac{\text{Winning Trades}}{\text{Total Closed Trades}} \times 100$ | Percentage of profitable trades |
| **Max Drawdown ($)** | $\max_{t} (\text{Peak Equity}_t - \text{Current Equity}_t)$ | Maximum peak-to-trough decline (intrabar adverse) |
| **Max Drawdown (%)** | $\max_{t} \left(\frac{\text{Peak Equity}_t - \text{Current Equity}_t}{\text{Peak Equity}_t}\right) \times 100$ | Maximum percentage equity drop |
| **Max Run-Up ($)** | $\max_{t} (\text{Current Equity}_t - \text{Trough Equity}_t)$ | Maximum favorable run-up during trades |
| **Sharpe Ratio** | $\frac{\bar{R} - R_f}{\sigma_R}$ | Annualized return over risk-free rate divided by volatility |
| **Sortino Ratio** | $\frac{\bar{R} - R_f}{\sigma_{\text{down}}}$ | Annualized excess return divided by downside deviation |
| **CAGR (%)** | $100 \times \left[\left(\frac{\text{Final Equity}}{\text{Initial Capital}}\right)^{\frac{365}{\text{Days}}} - 1\right]$ | Compound Annual Growth Rate over test horizon |
| **Buy \& Hold Return** | $\left(\frac{\text{Close}_{\text{last}} - \text{Open}_{\text{first}}}{\text{Open}_{\text{first}}}\right) \times 100$ | Return of holding the asset over the identical period |

---

## 4. Detailed TradingView-Style UI Specifications

### 4.1 Vela WebGL2 Chart & On-Chart Trade Markers

The chart visualization is powered by Vela's high-performance renderer (`/tmp/Vela/src/renderers/native/core/NativeRenderer.ts`).
- **`TradeExecution` Overlay**:
  In `/tmp/Vela/src/renderers/shared/trade-markers.ts`, markers render directly onto the price pane:
  - **Long Entry**: Bright green up-arrow below the bar low with fill price tick on the left bar edge (`#089981`).
  - **Short Entry**: Bright red down-arrow above the bar high with fill price tick on the right bar edge (`#F23645`).
  - **Exit**: Capped arrow with an anchor bar connecting the execution price to the candle edge (`#2962FF`).
  - **Interactive Marker Tooltip**: Hovering an arrow displays order ID, trade number, execution price, filled contracts, and realized P&L.

### 4.2 Dockable Bottom Panel Architecture (`VelaBottomDock`)

Anchored below the chart grid, resizable via splitter (`/tmp/Vela/src/workspace/splitters.ts`):
- **Header Tabs**:
  - Tab 1: **Strategy Tester** (Active during backtesting)
  - Tab 2: **Pine Editor** (IDE for script authoring)
  - Tab 3: **Pine Logs / Console** (Compiler output, `log.info()`, margin warnings)
- **Controls**: Minimize, Maximize to full window, Close.

```
+----------------------------------------------------------------------------------------------------+
| [ Strategy Tester ]  [ Pine Editor ]  [ Pine Logs ]                      [-]  [^]  [x]             |
+----------------------------------------------------------------------------------------------------+
|  Overview  |  Performance Summary  |  List of Trades  |  Properties                               |
+----------------------------------------------------------------------------------------------------+
|  [ Net Profit: $24,850.20 (+24.85%) ]  [ Profit Factor: 1.84 ]  [ Win Rate: 58.4% (142/243) ]     |
|  [ Max Drawdown: $3,420.10 (4.12%) ]   [ Sharpe Ratio: 1.92 ]   [ Sortino Ratio: 2.65 ]           |
|----------------------------------------------------------------------------------------------------|
|  +-----------------------------------------------------------------------------------------------+ |
|  | CUMULATIVE EQUITY CURVE ($)                                          [--- Strategy] [--- B&H] | |
|  |     /\      /\    /\  /\                                                                      | |
|  |    /  \    /  \  /  \/  \                                                                     | |
|  | __/    \__/    \/        \____________________________________________________________________| |
|  +-----------------------------------------------------------------------------------------------+ |
|  | UNDERWATER DRAWDOWN (%)                                                                        | |
|  | 0% ------------------------------------------------------------------------------------------ | |
|  |   \    /\__/\       /\                                                                        | |
|  | -5%\__/      \_____/  \_______________________________________________________________________| |
|  +-----------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
```

### 4.3 Strategy Tester Sub-Views

#### Sub-View 1: Overview Tab
- **Metric KPI Cards**: Top horizontal band with formatted currency, percentages, and colored trend indicators.
- **Dual Canvas Equity Curve**:
  - Synchronized rendering of equity line and drawdown area.
  - Hover cursor with crosshair syncing back to the candlestick chart.
  - Benchmark toggle: Compare against Buy & Hold or S&P 500.

#### Sub-View 2: Performance Summary Tab
- **TradingView 3-Column Comparative Grid**:
  - Exact layout replicating TradingView's Strategy Tester:
    Columns: `Metric`, `All Trades`, `Long Trades`, `Short Trades`.
  - 24 standardized rows displaying counts, averages, ratios, and risk metrics.

#### Sub-View 3: List of Trades Tab (Virtualized Table)
- **High-Performance DOM Virtualization**:
  - Renders only visible rows inside the viewport container.
  - Supports smooth 60fps scrolling over 50,000+ trades without browser lag or DOM bloat.
- **Table Columns**:
  1. `Trade #`: Consecutive trade index.
  2. `Type`: `Entry Long`, `Exit Long`, `Entry Short`, `Exit Short`.
  3. `Signal`: Order ID or user comment passed to `strategy.entry`/`strategy.exit`.
  4. `Date / Time`: Localized epoch timestamp.
  5. `Price`: Actual execution fill price.
  6. `Contracts`: Filled position size.
  7. `Profit ($)`: Realized trade profit/loss.
  8. `Profit (%)`: Percentage gain/loss on trade capital.
  9. `Cum. Equity ($)`: Account equity post-trade.
  10. `Run-up ($ / %)`: Peak favorable excursion.
  11. `Drawdown ($ / %)`: Peak adverse excursion.
- **Interactive Capabilities**:
  - Clicking any trade row triggers `vela.scrollTimeToCenter(trade.time)` and highlights the corresponding trade marker on the chart.
  - Filter by Long/Short and Win/Loss.
  - Export full trade table to CSV.

### 4.4 Monaco Pine Script Editor Integration

- **Monarch Grammar**: Complete syntax highlighting for Pine Script v5 and v6.
- **IntelliSense Autocompletion**:
  - Function signatures with parameter defaults and documentation for `ta.*`, `strategy.*`, `math.*`, `request.*`.
  - Scoped variable completion within user-defined functions and scripts.
- **Error Diagnostics**: Red wavy underlines beneath syntax errors or unknown identifiers with instant tooltips.
- **Toolbar Actions**:
  - `Add to Chart`: Compiles and attaches the indicator/strategy to the active chart.
  - `Save Script`: Persists code to local storage or cloud workspace.
  - `New Script`: Dropdown with templates (Blank Indicator, SMA Strategy, Supertrend Strategy, Bracket Exit Strategy).

---

## 5. Testing Strategy & Parity Matrix

### 5.1 Verification Test Matrix

| Category | Target Component | Test Case / Scenario | Pass Criteria |
| :--- | :--- | :--- | :--- |
| **Transpiler & Loop** | `PineTS.class.ts` | 10,000 bars SMA indicator run | Executed in $< 5\text{ms}$; 0 microtask `await` delays |
| **Transpiler & Loop** | `CursorSeries.ts` | Lookback access `close[20]` | Returns correct historical values; 0 heap allocations |
| **Worker Off-Threading** | `PineWorkerEngine.ts` | Background script compilation & run | Main thread maintains 60fps during 100k bar run |
| **Worker Off-Threading** | `protocol.ts` | MTF `request.security` round-trip | Worker resolves secondary series without deadlock |
| **Broker Emulator** | `utils.ts:1235` | Gap-fill on market open | Exit fills at `openPrice`, not at the stop trigger price |
| **Broker Emulator** | `utils.ts:1747` | Intrabar wick polarity test | Adverse Stop Loss triggers before TP on bearish wick |
| **Broker Emulator** | `utils.ts:842` | Multi-lot FIFO partial liquidation | Oldest lot closed first; exit split across lot boundary |
| **Broker Emulator** | `utils.ts:1790` | Margin violation at adverse extreme | Position liquidated at adverse extreme; margin call logged |
| **UI Strategy Tester** | `VirtualizedTable.ts` | 50,000 trades table scroll | DOM maintains $\le 40$ table rows; 60fps scrolling |
| **UI Strategy Tester** | `EquityCurveCanvas.ts` | Crosshair synchronization | Hovering curve highlights correct candle on price pane |
| **Parity Verification** | Golden Reference Suite | 5 TV strategies on 10k bars | Realized P&L matches TV export within $0.01\%$ epsilon |

### 5.2 Reference Strategy Benchmark Suites

1. **SMA Crossover Strategy (`sma_cross.pine`)**:
   - Entry: Buy on `ta.crossover(ta.sma(close, 10), ta.sma(close, 50))`; Sell on crossunder.
   - Verifies: Basic market order execution at next bar open, reverse position handling.
2. **Supertrend Strategy (`supertrend.pine`)**:
   - Dynamic trailing stop band with volatility adjustment.
   - Verifies: Stateful indicator calculation, stop order execution on trend flip.
3. **Bollinger Band Mean Reversion (`bb_mean_reversion.pine`)**:
   - Limit orders placed at lower/upper bands.
   - Verifies: Limit order intrabar crossing against bar High and Low.
4. **Multi-Bracket OCA Exit Strategy (`bracket_oca.pine`)**:
   - Entry with OCA bracket defining Take Profit limit and Stop Loss stop.
   - Verifies: Cancellation of alternate order upon fill, gap-fill handling, FIFO lot matching.
5. **Margin-Constrained High Leverage Scalper (`margin_scalp.pine`)**:
   - 10x leverage position with tight margin maintenance.
   - Verifies: Intrabar adverse price excursion liquidation and margin call logging.

---

## 6. Technical Risks, Licensing Architecture & Trade-Offs

### 6.1 Licensing Architecture: AGPL-3.0 vs Apache-2.0

#### The Challenge
- PineTS and Vela-pinets are licensed under **AGPL-3.0-only** / Commercial.
- Vela core and standard frontend components are licensed under **Apache-2.0**.
- Inadvertently linking AGPL code into the main UI bundle could trigger copyleft obligations across the entire application.

#### The Architectural Seam & Solution
1. **Physical Process-Level Boundary**:
   - The AGPL engine (PineTS + Vela-pinets runtime) is compiled into an independent, standalone Web Worker bundle: `pinets-worker.js`.
   - The main UI thread imports zero AGPL symbols. It interacts strictly through the generic `ScriptingEngine` interface defined in `@luxalgo/vela/plugin` (Apache-2.0).
   - Communication between the main thread and the worker is strictly standard IPC (`postMessage`) passing structured-clone plain data objects and Transferable ArrayBuffers.
2. **Pluggable Engine Interface**:
   - PineOrca treats the scripting engine as a modular plugin. The system can swap in alternative engines (e.g. Python Pyodide, WebAssembly Rust engine) without touching UI code.
3. **Dual-Licensing Compliance**:
   - For open-source deployments, the standalone worker bundle is distributed with its AGPL source accessible.
   - For commercial/proprietary white-label deployments, PineTS provides a commercial license exemption, removing AGPL constraints entirely.

### 6.2 Technical Risks & Mitigation Strategies

| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Microtask Scheduling Bottleneck** | High | High | Unroll synchronous loops in PineTS (`_executeIterationsSync`). Wrap non-async scripts in synchronous closures, bypassing `await` overhead on historical bars. |
| **Memory Allocation Thrashing** | High | Medium | Implement `CursorSeries` using pre-allocated contiguous typed array buffers (`Float64Array`) instead of pushing to dynamic JS arrays on every bar. |
| **Worker IPC Transfer Overhead** | Medium | Medium | Use Transferable Objects (`ArrayBuffer`) for large datasets (OHLCV bars and equity curves) to achieve zero-copy thread transfer. |
| **Intrabar Path Ambiguity** | High | High | Implement TradingView's verified `isAdverseFirstBar` wick trajectory heuristic. Clearly document the assumption and provide optional Bar Magnifier / Lower Timeframe tick inspection. |
| **DOM Bloat in Strategy Tester** | High | Medium | Virtualize the trade table (`VirtualizedTable.ts`) to cap DOM elements to visible rows ($\le 40$ rows), guaranteeing smooth 60fps scrolling on 50k+ trades. |
| **Monaco Bundle Weight** | Medium | Low | Use dynamic ESM chunk loading for Monaco Editor, lazy-loading the IDE bundle only when the user opens the "Pine Editor" tab. |

---

## 7. Deliverables & Execution Plan Summary

Upon execution of this plan, PineOrca will deliver:
1. An unrolled, high-performance PineTS core capable of backtesting 10,000 bars in $< 5\text{ms}$.
2. A resilient Web Worker execution boundary maintaining 60fps UI responsiveness during intense computations.
3. An exact TradingView broker parity engine supporting gap fills, intrabar heuristics, FIFO multi-lot splitting, and margin liquidations.
4. A full-featured TradingView-style Strategy Tester (interactive equity curves, performance summary, virtualized trade table).
5. An embedded Monaco Pine Script IDE with live syntax diagnostics and one-click chart attachment.
6. A verified golden test suite guaranteeing mathematical and behavioral parity with TradingView.
