---
title: "PineOrca: High-Fidelity Pine Script v5/v6 Platform & Backtesting Architecture"
description: "End-to-end architecture and implementation roadmap for native Pine Script execution, TradingView-parity backtesting, and WebGL2 UI with Strategy Tester and Monaco IDE."
status: in_progress
priority: P1
effort: "36d"
tags: ["pinescript", "backtesting", "tradingview", "webgl2", "pinets", "vela"]
created: 2026-09-18
---

# PineOrca: High-Fidelity Pine Script v5/v6 Platform & Backtesting Architecture

## Executive Summary

PineOrca is an open, high-performance algorithmic trading and backtesting platform that delivers native Pine Script v5/v6 compatibility, microsecond-accurate broker-emulator execution matching TradingView parity, and a responsive TradingView-style financial charting workspace powered by WebGL2.

This implementation plan is the materialized winner of the **Ultra Verifier Mode (`ak:plan --ultra`)** architectural evaluation (selected with a master score of **97.0 / 100**). It unites the strengths of **PineTS** (transpiler pipeline, incremental TA mathematics, and 2,301-line broker kernel) and **Vela** (high-density WebGL2 rendering engine, multi-pane layout manager, and on-chart trade executions) while solving critical production bottlenecks:

1. **Zero-Copy Columnar Memory Architecture (`ColumnarBarTable` & `FastSeries`)**: Continuous `Float64Array` struct-of-arrays memory layout replacing boxed JavaScript object arrays, reducing heap footprint by 92.5% and enabling $<1\text{ms}$ transfers across Web Worker boundaries.
2. **Synchronous Hot-Loop Execution**: Static AST pre-resolution of `request.security` secondary timeframes before the bar loop, eliminating Promise microtask scheduling overhead during historical backtests.
3. **Inviolable Licensing Boundary**: Complete process isolation via a standalone Web Worker engine boundary. The host application (`@pineorca/shell`, `@pineorca/chart`, `@pineorca/ui`) is strictly **Apache-2.0**, while the copyleft execution kernel (`@pineorca/engine-pinets`) is encapsulated inside an isolated Web Worker under **AGPL-3.0**.
4. **TradingView-Grade Strategy Tester**: A 3-state dockable bottom panel providing an Overview tab (KPI cards + Canvas Equity and Underwater Drawdown curves), a 3-column Performance Summary table (All, Long, Short), and a high-density virtualized List of Trades table with bi-directional chart cross-probing.
5. **Integrated Monaco Pine IDE**: Embedded editor with Pine v5/v6 syntax highlighting and real-time compilation diagnostics.

```mermaid
flowchart TD
    subgraph UI_Shell [Apache-2.0 UI Shell]
        Vela[Vela WebGL2 Chart Canvas]
        Editor[Monaco Pine Script IDE]
        Tester[Strategy Tester Panel\nOverview | Summary | Trades Grid]
        Probe[CrossProbe Controller]
    end

    subgraph Data_Layer [Data & Storage Engine]
        L1[ColumnarBarStore\nIn-Memory LRU]
        L2[IndexedDBStore\nCompressed Binary Chunks]
        Feed[CachingDataFeed\nREST / WebSocket]
    end

    subgraph Worker_Seam [Inviolable Worker Seam: Transferable ArrayBuffers]
        Bridge[WorkerBridge RPC Client]
    end

    subgraph Worker_Runtime [AGPL-3.0 Web Worker Sandbox]
        Transpiler[PineTS v5/v6 Transpiler]
        Engine[StrategyKernel Loop\nOrder Matching & Margin Calls]
        Series[FastSeries Lookback\nFloat64Array SOAs]
        Ledger[FIFOLedger & Metrics Engine]
    end

    Vela <--> Probe
    Probe <--> Tester
    Editor --> Bridge
    L1 <--> Feed
    L1 <--> L2
    Bridge -->|Zero-Copy ArrayBuffer Transfer| Engine
    Bridge <-->|RPC Messages| Engine
    Engine --> Transpiler
    Engine --> Series
    Engine --> Ledger
    Ledger -->|Scene Model & TradeExecutions| Bridge
    Bridge --> Vela
    Bridge --> Tester
```

---

## Goals & Core Capabilities

| # | Goal | Target Metric | Priority |
|---|------|---------------|:--------:|
| 1 | **Native Pine v5/v6 Execution** | 100% syntax compatibility with standard indicators and strategies | P1 |
| 2 | **TradingView Broker Parity** | Zero trade count mismatch; $\le 0.001\%$ net profit deviation | P1 |
| 3 | **Columnar Memory Scaling** | $<1\text{ms}$ transfer of 100,000 bars; 0ms GC freezes | P1 |
| 4 | **WebGL2 Visualization** | 60–144 FPS smooth pan/zoom with multi-pane oscillators & trade markers | P1 |
| 5 | **Dockable Strategy Tester** | 3-state drawer (Overview, 3-column Summary, virtualized List of Trades) | P1 |
| 6 | **Monaco Pine Script IDE** | Pine v5/v6 syntax highlighting, diagnostics, and "Add to Chart" | P2 |
| 7 | **Live Streaming with Rollback** | 1,000 ticks/sec throughput with provisional bar state restore | P2 |

---

## Phased Implementation Roadmap

| Phase | Title | Focus Area | Status | Effort |
|:---:|---|---|:---:|:---:|
| **1** | [Columnar Storage & Worker IPC](./phase-01-columnar-storage-worker-ipc.md) | Zero-copy `Float64Array` buffers, IndexedDB caching, Typed Worker Bridge | Completed | 5d |
| **2** | [Transpiler & Execution Kernel](./phase-02-transpiler-execution-kernel.md) | PineTS v5/v6 parser, AST callsite IDs, `FastSeries`, sync loop unrolling | Pending | 7d |
| **3** | [Broker Emulator & TV Parity](./phase-03-broker-emulator-parity.md) | Order precedence, FIFO lot splitting, intrabar polarity, margin calls | Pending | 7d |
| **4** | [Vela Chart & Trade Markers](./phase-04-vela-chart-trade-markers.md) | WebGL2 canvas mount, multi-pane routing, scene translator, trade markers | Pending | 5d |
| **5** | [Strategy Tester & Monaco IDE](./phase-05-strategy-tester-monaco-ide.md) | Dockable container, equity curve, summary grid, virtual trade list, editor | Pending | 7d |
| **6** | [Streaming & Golden Parity Suite](./phase-06-streaming-golden-parity.md) | WebSocket tick streaming, provisional rollback, 5-strategy TV oracle tests | Pending | 5d |

---

## Architectural Deep Dive

### 1. Zero-Copy Columnar Memory Model
Standard JavaScript objects create extreme memory pressure during deep backtests:
* 100,000 bars with 12 indicators allocate over 1.3 million heap objects, resulting in $\sim 165\text{MB}$ heap churn and $185\text{ms}$ serialization delay per worker invocation.
* PineOrca replaces this with `ColumnarBarTable`, packing `time`, `open`, `high`, `low`, `close`, and `volume` into a single continuous `ArrayBuffer` structured as six contiguous 64-byte aligned `Float64Array` buffers.
* Memory footprint drops to **$4.8\text{MB}$ (92.5% reduction)**, and data transfers to the Web Worker take **$<1\text{ms}$** using native `ArrayBuffer` transfer lists.

### 2. Microsecond-Parity Broker Emulator
PineOrca ports and hardens the 2,301-line verified broker engine (`strategy/utils.ts`):
* **Order Execution Precedence**: Orders queued on bar $N$ evaluate at bar $N+1$ open.
* **Mintick Grid Snapping**: Stop and limit orders round away from the reference price to trigger later, mirroring real-world broker execution (`strategy/utils.ts:78-86`).
* **Intrabar Polarity State Machine**:
  - If $|H - O| \le |O - L|$, the bar is **Adverse-First**: adverse extreme margin evaluation occurs *before* exit orders.
  - If $|H - O| > |O - L|$, the bar is **Favorable-First**: exit orders evaluate first, freeing margin before the extreme.
* **Gap-Fill TV Asymmetry**: Replicates the 637-event empirical behavior where in-the-money buy stops at open spare fresh same-open entries, while sell stops execute against them (`strategy/utils.ts:1515-1524`).
* **Multi-Checkpoint Margin Liquidation**: Evaluates margin at `open`, `extreme`, and `close`. On margin breach, liquidates contracts using the 4× deficit cover buffer formula:
  $$\text{Liquidate Qty} = \min\left(|\text{Position Size}|, \frac{4 \times \text{Deficit}}{\text{Price} \times \text{PointValue}}\right)$$
* **FIFO Lot Matching**: Physical lots (`opentrades`) maintain immutable `_bracket_entry` prices for TP/SL calculations, while accounting rows (`closedtrades`) strictly consume oldest entries first with pro-rata entry commission netting.

### 3. Clean Licensing Separation
* `@pineorca/shell`, `@pineorca/chart`, and `@pineorca/ui` are licensed under **Apache-2.0**, maintaining full commercial permissiveness.
* The execution engine `@pineorca/engine-pinets` is built as an isolated, standalone Web Worker compiled from **AGPL-3.0** source code.
* Communication occurs strictly across the asynchronous `postMessage` protocol using vendor-neutral scene data structures, satisfying legal isolation requirements for proprietary host applications.

---

## Verification & Parity Acceptance Thresholds

To guarantee TradingView parity, PineOrca runs automated regression tests against 5 canonical reference strategies with ground-truth data exported directly from TradingView:

| Strategy Benchmark | Core Test Invariant | Allowed Divergence |
|---|---|:---:|
| **RSI Mean Reversion** | Single entry/exit, next-bar open market fills | 0 trade mismatch; PnL $\le 0.001\%$ |
| **Bollinger Bands Breakout** | Pyramiding = 3, FIFO ledger splitting | 0 trade mismatch; PnL $\le 0.001\%$ |
| **MACD Dual Reversal** | Directional position flipping & commission netting | 0 trade mismatch; PnL $\le 0.001\%$ |
| **Turtle Trend System** | Trailing stops, mintick snapping, bracket tracking | 0 trade mismatch; PnL $\le 0.001\%$ |
| **Leveraged Crypto Perpetual** | March 2020 crash, 4× margin deficit liquidation | 0 trade mismatch; PnL $\le 0.01\%$ |

---

## Ultra Verifier Mode: Scoring & Ranking Appendix

Anonymized multi-candidate evaluation conducted under **Ultra Verifier Mode (`ak:plan --ultra`)**:

| Rank | Candidate Identifier | Master Score (/100) | Evaluation Summary | Verdict |
|:---:|---|:---:|---|:---:|
| **1st** | **Candidate C** (Plan Materialized) | **97.0** | Masterclass in memory optimization (`ColumnarBarTable`), 2,301-line broker kernel parity, sync loop unrolling, and clean AGPL worker seam. | **WINNER** |
| 2nd | Candidate A | 94.0 | Excellent developer ergonomics, comprehensive Monaco IDE integration, and detailed error-recovery pipelines. | Runner-up |
| 3rd | Candidate B | 91.5 | Deep mathematical analysis of margin liquidation checkpoints and FIFO lot decoupling. | Honorable Mention |
| 4th | Candidate D | 90.5 | Pragmatic browser-first focus with modular testing suites. | Honorable Mention |
| 5th | Candidate E | 88.5 | Strong IndexedDB storage design; slightly higher heap allocations in series lookbacks. | Qualified |

*Full verification notes and per-criterion evaluations are preserved in `reports/ultra-verification-report.md`.*
