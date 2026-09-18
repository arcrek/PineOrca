# PineOrca Ultra Verifier Report: Comprehensive Multi-Candidate Evaluation & Final Selection

**Document Version**: 1.0.0  
**Date**: 2026-09-18  
**Evaluator**: Ultra Verifier (`ak:plan --ultra`)  
**Subject**: Architectural Plans for PineOrca (High-Fidelity Pine Script v5/v6 Platform, TradingView Parity Backtesting Engine, and WebGL2 Financial Charting Interface)

---

## 1. Executive Summary

PineOrca represents an ambitious engineering endeavor: to unify a browser-native Pine Script v5/v6 execution engine, a microsecond-accurate broker emulator matching TradingView's execution semantics, and a high-performance WebGL2 financial charting interface with a full-featured Strategy Tester and Monaco IDE.

Five independent planning candidates submitted comprehensive implementation architectures:
- **Candidate A (`candidate-A.md`)**: Developer-First Ergonomics, Test-Driven Parity Verification, Phased Milestones, Drawing Extensions, and Comprehensive Error Handling.
- **Candidate B (`candidate-B.md`)**: Rigorous Broker-Emulator Parity, Mathematical Correctness, WebGL2 Charting & TradingView-Style Strategy Tester.
- **Candidate C (`candidate-C.md`)**: Ultra-Scale Production Architecture, Zero-Copy Columnar Execution, Microsecond-Parity Broker Emulator, and Full TradingView Dockable Workspace.
- **Candidate D (`candidate-D.md`)**: High-Performance Browser-First Pine Script v5/v6 Execution, TV Broker Parity Backtesting & Modular WebGL2 UI Platform.
- **Candidate E (`candidate-E.md`)**: Full-Stack Modular Architecture, Isolated AGPL Worker Runtime, Persistent IndexedDB Data Engine, and Interactive Strategy Tester.

Following exhaustive cross-comparative review across five core engineering dimensions (Completeness & Scope, Architectural Soundness, Phase Decomposition, Testing & Parity Verification, and Risk Mitigation), **Candidate C** has been selected as the **Official Winning Architecture** with a global score of **97.0 / 100**.

Candidate C distinguishes itself through its mathematical and empirical fidelity to the 2,301-line PineTS broker engine (`strategy/utils.ts`), its zero-copy columnar typed-array memory pipeline (`ColumnarBarTable` & `FastSeries`) that eliminates V8 garbage collection freezes across $100,000+$ bars, its elegant two-pass static AST pre-resolution for `request.security` (keeping hot historical loops purely synchronous), its rigorous legal seam isolating AGPL-3.0 copyleft code in a standalone worker, and its nuanced understanding of subtle TradingView quirks (such as the 637-event buy-stop same-open gap asymmetry census).

---

## 2. Evaluation Rubric & Methodology

Each candidate plan was evaluated against five rigorous criteria, each weighted equally from 1 to 20 points (Total Score: 100 points):

```
+-------------------------------------------------------------------------------------------------------+
| EVALUATION RUBRIC (100 POINTS MAXIMUM)                                                               |
+-------------------------------------------------------------------------------------------------------+
| 1. Completeness & Scope Faithfulness (1-20 Points)                                                    |
|    - Thoroughness of all three core pillars:                                                          |
|      (a) Runtime Engine (PineTS, transpiler, series, context, ta.* math)                              |
|      (b) Broker Parity & Backtesting (order matching, intrabar polarity, FIFO, margin, metrics)       |
|      (c) UI & Strategy Tester (Vela WebGL2 multi-pane, TradeExecution markers, dockable panel, Monaco)  |
+-------------------------------------------------------------------------------------------------------+
| 2. Architectural Soundness & Realism (1-20 Points)                                                   |
|    - Web Worker off-threading and zero-copy binary IPC (Transferable ArrayBuffers)                   |
|    - Synchronous loop execution vs. microtask Promise overhead (`_executeIterationsSync`)             |
|    - Memory management, continuous Float64Array storage, and GC elimination for 100k+ bars          |
|    - Strict legal boundary separating AGPL-3.0 execution code from Apache-2.0 UI components           |
+-------------------------------------------------------------------------------------------------------+
| 3. Phase Decomposition & Execution Clarity (1-20 Points)                                              |
|    - Logical dependency sequencing across implementation phases                                      |
|    - Concrete, verified file paths, modules, and monorepo package layout                              |
|    - Granular, actionable step-by-step development tasks                                              |
|    - Reproducible, automated terminal verification commands for each phase                            |
+-------------------------------------------------------------------------------------------------------+
| 4. Testing Strategy & Parity Verification (1-20 Points)                                              |
|    - Concrete automated verification test commands (Vitest, ts-node, custom runners)                 |
|    - Ground-truth reference benchmark datasets and canonical TradingView strategy suites              |
|    - Mathematical parity tolerance matrix (strict numerical float epsilons)                           |
|    - Deep-diff assertion flow for trade fills, excursion metrics (MAE/MFE), and equity curves        |
+-------------------------------------------------------------------------------------------------------+
| 5. Risk Mitigation & Honest Trade-offs (1-20 Points)                                                 |
|    - Intrabar price path reconstruction (wick proximity |H - O| <= |O - L| vs. Bar Magnifier)        |
|    - Browser memory pressure, large dataset scrolling (virtualized DOM tables)                        |
|    - Malformed script sandboxing (infinite loops, DoS protection, watchdog timers)                   |
|    - Nuanced edge cases: same-bar reversal gap fills, 4x margin deficit cover, drawdown denominators  |
+-------------------------------------------------------------------------------------------------------+
```

---

## 3. Master Scoreboard & Global Rankings

| Rank | Candidate | C1: Completeness (1-20) | C2: Architecture (1-20) | C3: Phases (1-20) | C4: Testing (1-20) | C5: Risk & Trade-offs (1-20) | Total Score (/100) | Status |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1st** | **Candidate C** | **19.5** | **19.5** | **19.5** | **19.0** | **19.5** | **97.0** | **WINNER** |
| **2nd** | **Candidate A** | **19.0** | **18.5** | **19.0** | **19.0** | **18.5** | **94.0** | Runner-up |
| **3rd** | **Candidate B** | **18.0** | **18.5** | **17.5** | **19.0** | **18.5** | **91.5** | Honorable Mention |
| **4th** | **Candidate D** | **18.0** | **18.5** | **18.0** | **18.0** | **18.0** | **90.5** | Honorable Mention |
| **5th** | **Candidate E** | **18.5** | **16.5** | **18.5** | **18.5** | **16.5** | **88.5** | Qualified |

---

## 4. In-Depth Candidate Evaluations

---

### Candidate C — Ultra-Scale Production Architecture, Zero-Copy Columnar Execution, Microsecond-Parity Broker Emulator, and Full TradingView Dockable Workspace

- **Total Score**: **97.0 / 100**
- **Global Rank**: **1st Place (Winner)**

#### Rubric Breakdown
- **Criterion 1: Completeness & Scope Faithfulness**: **19.5 / 20**  
  Candidate C delivers exhaustive coverage across all three pillars. On the runtime front, it replaces standard boxed object arrays with continuous columnar typed buffers (`ColumnarBarTable` and `FastSeries`). On backtesting, it grounds its specification directly in the 2,301-line verified broker kernel (`strategy/utils.ts`), incorporating mintick grid snapping away from reference price (`lines 78-86`), intrabar polarity state machines (`lines 1747-1756`), TV-empirical gap-fill asymmetries (`lines 1515-1524`), and multi-checkpoint margin calls with a 4x deficit cover buffer (`lines 1759-1911`). On the UI front, it specifies Vela WebGL2 multi-pane integration, fixed-pixel `TradeMarkerLayer` geometry (`BAR_GAP = 10`, `ARROW_H = 14`, `TICK_W = 6`), a 3-state dockable bottom panel (minimized 36px, split 340px, maximized 100%), a virtualized trade data grid (`VirtualDataGrid`) handling 50,000+ trades at 60 FPS, and bi-directional cross-probing.
- **Criterion 2: Architectural Soundness & Realism**: **19.5 / 20**  
  Candidate C is peerless in its memory and execution modeling. It documents the exact V8 heap breakdown for 100,000 bars: traditional object arrays allocate 100,000 bar objects plus 1,200,000 auxiliary series insertions across 12 series, generating $\sim 165\text{ MB}$ of transient heap churn and 185ms serialization delays. Candidate C's 64-byte aligned `Float64Array` struct-of-arrays reduces memory footprint by 92.5% to $4.8\text{ MB}$ continuous buffer, transferred across worker threads in $<1\text{ms}$ with zero runtime GC pauses. Furthermore, it resolves the async-in-hot-loop problem through two-pass static AST pre-resolution: the worker scans for `request.security`, requests and aligns secondary series before the bar loop, and then runs the sequential execution loop 100% synchronously. The AGPL-3.0 vs. Apache-2.0 seam is legally pristine, establishing a process-isolated worker communicating via neutral DTOs.
- **Criterion 3: Phase Decomposition & Execution Clarity**: **19.5 / 20**  
  Six dependency-ordered phases laid out with an accompanying Gantt chart:
  1. High-Performance Columnar Storage & Worker IPC Subsystem
  2. Native Pine v5/v6 Transpiler & Core Execution Kernel
  3. Broker Emulator & TradingView Parity Engine
  4. Vela WebGL2 Chart Integration & Trade Marker Subsystem
  5. Dockable Strategy Tester & Monaco Pine Script IDE
  6. Live Streaming Engine, Golden Test Suite & TV Oracle Parity  
  Every phase defines explicit package paths (`packages/data`, `packages/worker-bridge`, `packages/engine-pinets`, `packages/chart`, `packages/ui`), step-by-step tasks, and verifiable test commands with clear pass criteria.
- **Criterion 4: Testing Strategy & Parity Verification**: **19.0 / 20**  
  Defines 5 canonical reference strategies (RSI Mean Reversion, Bollinger Breakout Pyramiding, MACD Reversal, Turtle Trailing Stop, Leveraged Crypto Margin Liquidation). Establishes a concrete TypeScript tolerance contract `PARITY_THRESHOLDS` enforcing 0 closed trade mismatches, 0 win/loss count deviations, $\le 0.01\%$ net profit, and $\le 0.05\%$ max drawdown. Features an automated parity runner comparing outputs directly against TradingView export files, plus a live streaming stress test at 1,000 ticks/sec with state rollbacks.
- **Criterion 5: Risk Mitigation & Honest Trade-offs**: **19.5 / 20**  
  Identifies and resolves subtle TradingView quirks that other plans missed entirely:
  - *Same-Bar Reversal + Gap SL*: Employs `buyStopSparesFreshEntry` (`strategy/utils.ts:1523`) to avoid closing fresh entries.
  - *Persistent Exit Cadence*: Tracks exit call history to mark orders `_isPersistent` (`strategy/types.ts:326`).
  - *100% Margin Calls*: Enforces mark-to-market insolvency even under zero leverage (`margin_long = 100`).
  - *Fractional Lookback Truncation*: Enforces `Math.trunc(lookback)` in `FastSeries.get()`.
  - *Max Drawdown % Denominator*: Calculates DD% against equity peak at the moment of the latch event rather than initial capital.
  - *Architectural Trade-offs*: Analyzes Columnar FastSeries vs. Dynamic UDTs (dual storage engine), Worker async lookback vs. synchronous loop (two-pass pre-fetch), and WebSocket firehoses vs. UI framerate (RAF 60/120Hz batching).

#### Key Strengths
1. **Unrivaled Memory Architecture**: Struct-of-arrays continuous buffer model with full performance benchmarks (185x faster data transfer, 92.5% heap reduction, 0ms GC pauses).
2. **Deepest Codebase Grounding**: Cites exact line numbers and logic inside `/tmp/PineTS/src/namespaces/strategy/utils.ts` and `types.ts`.
3. **Pristine Licensing Seam**: Inviolable process-level worker boundary that strictly encapsulates AGPL-3.0 copyleft obligations while preserving Apache-2.0 commercial flexibility.
4. **Synchronous Loop Preservation**: Elegant two-pass static AST pre-resolution for `request.security` eliminates microtask Promise scheduling during backtesting.
5. **Nuanced Edge Cases**: Masterclass in subtle TradingView behaviors (637-event gap census, 4x deficit cover, equity latching).

#### Weaknesses & Constructive Notes
- Does not detail user-defined drawing extensions (`line.new`, `box.new`, `table.new`) as exhaustively as Candidate A.
- Could adopt Candidate B's explicit mathematical equations for intra-bar Bar Magnifier lower-timeframe slicing (`buildLtfSlices`).

---

### Candidate A — Developer-First Ergonomics, Test-Driven Parity Verification, Phased Milestones, Drawing Extensions, and Comprehensive Error Handling

- **Total Score**: **94.0 / 100**
- **Global Rank**: **2nd Place (Runner-up)**

#### Rubric Breakdown
- **Criterion 1: Completeness & Scope Faithfulness**: **19.0 / 20**  
  Candidate A is the most expansive document (974 lines), distinguished by its exceptional focus on developer ergonomics, compiler error handling, and visual drawing extensions. It specifies full multi-pane drawing support for `line.new`, `box.new`, `label.new`, `table.new` (pinned on-chart HUDs), `polyline.new`, and `linefill.new`. It details pixel-perfect visual geometry for `TradeExecution` markers (9x6px head, 3px stem, 2px exit cap, 6x8px tick notch, chronological text stacking).
- **Criterion 2: Architectural Soundness & Realism**: **18.5 / 20**  
  Specifies `BinaryBarBuffer` with `Float64Array` transferables and a clean licensing seam isolating AGPL-3.0 in `pinets.worker.js`. Features an outstanding two-layer sandboxing model: Layer 1 AST loop guards (`__loop_guard_42 > 500000`) and Layer 2 hardware worker watchdogs (10-second timer with automatic termination and respawn). However, its `FastSeries` lookback implementation relies on a fixed-capacity ring buffer with modulo arithmetic; while $O(1)$, ring buffers risk clipping deep historical lookbacks past buffer capacity or require complex dynamic resizing, unlike Candidate C's pre-allocated contiguous slices. Furthermore, it does not analyze the microtask Promise scheduling overhead of `await transpiledFn(context)` as deeply as Candidates C and D.
- **Criterion 3: Phase Decomposition & Execution Clarity**: **19.0 / 20**  
  Six clean phases with clear monorepo packaging (`packages/engine-pinets`, `packages/chart`, `packages/ui-shell`, `packages/editor`). Actionable step-by-step tasks and concrete verification commands throughout.
- **Criterion 4: Testing Strategy & Parity Verification**: **19.0 / 20**  
  Excellent testing section. Cites 3 golden datasets (`GOLDEN-BTCUSDT-1D`, `GOLDEN-AAPL-1H`, `GOLDEN-EURUSD-15M`) with exact bar counts. Tests 5 benchmark strategies. Provides an explicit Parity Metric Tolerance Matrix with rationales, and includes a full, production-ready automated parity runner code implementation (`tests/parity/runner.ts`).
- **Criterion 5: Risk Mitigation & Honest Trade-offs**: **18.5 / 20**  
  Addresses licensing governance, intrabar ambiguity vs. Bar Magnifier, 100k+ bar memory pressure, and malformed script sandboxing. Strong, practical mitigations.

#### Key Strengths
1. **Developer Ergonomics & Diagnostics**: Multi-tier diagnostic catalog (`PineDiagnostic`, codes like `LEX_TAB_SPACE_MIX`, `PARSE_INVALID_REASSIGNMENT`, `SEM_INVALID_SERIES_ARG`) with auto-fix suggestions.
2. **Defensive Sandboxing**: Two-layer infinite loop protection (AST loop guards + main-thread watchdog timer with automatic worker respawn).
3. **Visual Geometry Precision**: Concrete pixel specifications for trade markers and full coverage of Pine drawing namespaces (`table.new`, `box.new`, `polyline.new`).
4. **Complete Automated Test Runner Code**: Fully written TypeScript harness for golden dataset assertions.

#### Weaknesses & Constructive Notes
- Ring buffer modulo indexing in `FastSeries` introduces lookback capacity constraints.
- Microtask unrolling in the hot bar loop is less detailed than Candidate C or D.

---

### Candidate B — Rigorous Broker-Emulator Parity, Mathematical Correctness, WebGL2 Charting & TradingView-Style Strategy Tester

- **Total Score**: **91.5 / 100**
- **Global Rank**: **3rd Place**

#### Rubric Breakdown
- **Criterion 1: Completeness & Scope Faithfulness**: **18.0 / 20**  
  Candidate B provides an outstanding mathematical specification of broker emulation. It includes complete mathematical equations for gap fills, synthetic polarity heuristics, Bar Magnifier LTF sub-bar slicing, FIFO lot liquidation, OCA exit brackets, trailing stop arming and peak tracking, margin maintenance ($\mathcal{M}_{\text{held}}$ and $\mathcal{E}$), the 4x deficit liquidation rule, and 26 quantitative financial metrics (including MAE and MFE equations). On the UI side, it specifies Vela WebGL2, trade execution markers with dotted green/red trace lines, hover tooltips, and a 3-tab Strategy Tester.
- **Criterion 2: Architectural Soundness & Realism**: **18.5 / 20**  
  Strong understanding of Web Worker off-threading, Transferable ArrayBuffers, and licensing isolation. Mentions `_executeIterationsSync` and typed array reverse cursors in `Series.ts`. However, it lacks a multi-tier persistent storage pipeline (such as IndexedDB block caching) for multi-year datasets.
- **Criterion 3: Phase Decomposition & Execution Clarity**: **17.5 / 20**  
  Six phases with concrete tasks and verification commands. However, its phase sequencing is slightly counter-intuitive: it starts with the Broker Emulator in Phase 1 and Bar Magnifier in Phase 2, deferring the Web Worker host and IPC streaming protocol to Phase 4. Establishing the core execution and communication foundation after the broker emulator creates an inverted dependency order.
- **Criterion 4: Testing Strategy & Parity Verification**: **19.0 / 20**  
  Strongest benchmark strategy suite in terms of variety: specifies 10 canonical TradingView golden test strategies with exact names, tested mechanics, and zero-dollar/0.001% acceptance tolerances. Features a clean deep-diff assertion flow diagram.
- **Criterion 5: Risk Mitigation & Honest Trade-offs**: **18.5 / 20**  
  Features an explicit Technical Risk Matrix (severity, likelihood, impact, architectural mitigation) and explicitly addresses key trade-offs: Synthetic Polarity vs. Bar Magnifier, Dedicated vs. Shared Web Worker, and Monaco Editor dynamic loading.

#### Key Strengths
1. **Mathematical Formulation Rigor**: Pristine mathematical definitions for margin held, equity, 4x deficit cover, trailing stop ratchets, MAE/MFE, Sharpe, Sortino, and CAGR.
2. **Bar Magnifier Implementation**: Detailed specification of lower-timeframe sub-bar slicing (`buildLtfSlices`, `resolveOrdersOnLtfSlice`) to resolve intra-bar ambiguity.
3. **10 Canonical Golden Test Strategies**: Broadest reference strategy coverage among all candidates.
4. **Trade Trace Visuals**: Dotted connector lines linking entry and exit markers, colored by trade PnL outcome.

#### Weaknesses & Constructive Notes
- Inverted phase ordering (Worker/IPC in Phase 4 after Broker Emulator in Phase 1).
- Omits persistent browser data caching (IndexedDB L2 storage).
- Less detail on compiler diagnostics and AST error recovery compared to Candidate A.

---

### Candidate D — High-Performance Browser-First Pine Script v5/v6 Execution, TV Broker Parity Backtesting & Modular WebGL2 UI Platform

- **Total Score**: **90.5 / 100**
- **Global Rank**: **4th Place**

#### Rubric Breakdown
- **Criterion 1: Completeness & Scope Faithfulness**: **18.0 / 20**  
  Solid coverage across all three pillars. Details the two-phase bar execution model, gap-fill logic (`utils.ts:1235`), intrabar polarity (`utils.ts:1747`), FIFO liquidation (`utils.ts:842`), margin checks (`utils.ts:1790`), and 24 performance metrics. Specifies Vela WebGL2 chart integration, bottom dock using splitters from `/tmp/Vela/src/workspace/splitters.ts`, dual-canvas Strategy Tester, and Monaco editor.
- **Criterion 2: Architectural Soundness & Realism**: **18.5 / 20**  
  Candidate D provides an exceptionally sharp diagnosis of the exact microtask scheduling bottleneck in PineTS: in `PineTS.class.ts:1140-1220` and `WrapperTransformer.ts:55-81`, wrapping the generated JS in `async (context) => { ... }` causes `await transpiledFn(context)` to execute on every single bar, incurring devastating microtask queue overhead across 100,000 bars. It designs `_executeIterationsSync` and `CursorSeries.ts` to solve this. Includes a concrete bash verification script `verify-licensing-boundary.sh`. However, it lacks persistent browser data caching (IndexedDB).
- **Criterion 3: Phase Decomposition & Execution Clarity**: **18.0 / 20**  
  Six clean, logical phases. Directly references existing repository paths in `/tmp/PineTS`, `/tmp/Vela-pinets`, and `/tmp/Vela`. Step-by-step tasks are clear, and verification commands include an inline Node.js benchmark checking 10k bars execution under 5ms.
- **Criterion 4: Testing Strategy & Parity Verification**: **18.0 / 20**  
  Includes a structured Verification Test Matrix table mapping components to test scenarios and pass criteria, plus 5 benchmark strategies. Slightly less expansive than Candidates B, C, or A in its fixture data descriptions.
- **Criterion 5: Risk Mitigation & Honest Trade-offs**: **18.0 / 20**  
  Practical risk table covering microtask bottlenecks, memory allocation thrashing, worker IPC transfer overhead, intrabar ambiguity, DOM bloat in trade tables, and Monaco bundle weight.

#### Key Strengths
1. **Accurate Diagnosis of Loop Bottleneck**: Pinpoints the exact lines in `PineTS.class.ts` and `WrapperTransformer.ts` where async wrapping kills backtest performance.
2. **Immediate Grounding in Existing Code**: Directly targets the actual files in `/tmp/PineTS`, `/tmp/Vela-pinets`, and `/tmp/Vela`.
3. **Microsecond Performance Target**: Concrete benchmark asserting 10,000 bars execution in $< 5\text{ms}$.
4. **Structured Verification Matrix**: Clear mapping of target components, scenarios, and pass criteria.

#### Weaknesses & Constructive Notes
- Shortest plan (590 lines), omitting deeper data storage architecture (IndexedDB L2 chunking).
- Lacks extended Pine drawing primitives (`table.new`, `box.new`, `polyline.new`).
- Modest parity test fixture matrix compared to Candidates B and E.

---

### Candidate E — Full-Stack Modular Architecture, Isolated AGPL Worker Runtime, Persistent IndexedDB Data Engine, and Interactive Strategy Tester

- **Total Score**: **88.5 / 100**
- **Global Rank**: **5th Place**

#### Rubric Breakdown
- **Criterion 1: Completeness & Scope Faithfulness**: **18.5 / 20**  
  Candidate E provides excellent architectural breadth. It designs a full monorepo with `@pineorca/protocol`, `@pineorca/engine-pinets`, `@pineorca/data`, `@pineorca/chart`, and `@pineorca/shell`. It excels in the data storage pillar, specifying a two-tier storage engine with an in-memory L1 LRU cache (`BarStore`) and a persistent L2 IndexedDB chunked store (`IndexedDBBarStore.ts` storing 1,000-bar binary blobs). On the UI side, it details Vela WebGL2, `TradeMarkersRenderer.ts` with hover halos and spatial indexing (quadtree/binary search), `BottomDock`, a 3-tab Strategy Tester with CSV/XLSX export, and a two-way cross-probing coordinator with animated duration corridors.
- **Criterion 2: Architectural Soundness & Realism**: **16.5 / 20**  
  Candidate E has great monorepo and data storage architecture, including an automated licensing check (`! grep -rn "PineTS" packages/shell/dist/`). However, it suffers from a **critical architectural and mathematical defect in its intrabar polarity model** (detailed below in Criterion 5 and Key Weaknesses). Furthermore, it does not analyze or address the microtask loop unrolling problem (`_executeIterationsSync`) in the transpiler.
- **Criterion 3: Phase Decomposition & Execution Clarity**: **18.5 / 20**  
  Six well-structured phases with a Gantt chart, clean monorepo paths, detailed task breakdowns, and concrete verification commands. Phase 2 (IndexedDB Chunked Storage) is the best data subsystem plan among all candidates.
- **Criterion 4: Testing Strategy & Parity Verification**: **18.5 / 20**  
  Features an extensive 12-reference strategy matrix (`S01` to `S12`) covering SMA, Bollinger, Supertrend, Pyramiding, Multi-Bracket, Polarity, Gaps, Margin Call, HTF Security, Multi-Currency, Dynamic Sizing, and Commission/Slippage, with strict numerical delta criteria. Includes a comprehensive release verification gate script.
- **Criterion 5: Risk Mitigation & Honest Trade-offs**: **16.5 / 20**  
  **Load-Bearing Defect Identified**: In Section 3 (lines 255-256) and Section 4.2 (lines 520-531), Candidate E defines intrabar price trajectory as:
  $$\text{If } \text{Close} \ge \text{Open}: \quad \text{Open} \longrightarrow \text{Low} \longrightarrow \text{High} \longrightarrow \text{Close}$$
  $$\text{If } \text{Close} < \text{Open}: \quad \text{Open} \longrightarrow \text{High} \longrightarrow \text{Low} \longrightarrow \text{Close}$$
  *This is factually incorrect and diverges from TradingView's verified broker emulator*. In TradingView and PineTS (`strategy/utils.ts:1747-1756`), intrabar path is determined by **whether Open is closer to High or Low** (the wick proximity rule: $|High - Open| \le |Open - Low|$), **NOT** by whether `Close >= Open`!  
  For example, on a bullish hammer candle where $\text{Close} > \text{Open}$ but the long lower wick makes $\text{Open}$ much closer to $\text{High}$ than to $\text{Low}$, TradingView resolves the path as $\text{Open} \to \text{High} \to \text{Low} \to \text{Close}$. Candidate E's formula would incorrectly reverse this to $\text{Open} \to \text{Low} \to \text{High} \to \text{Close}$, triggering false stop-losses before take-profits. This defect would cause systemic divergence across hundreds of historical bars.

#### Key Strengths
1. **Best Persistent Data Pipeline**: Two-tier caching with L1 LRU and L2 IndexedDB chunked storage (compact 48KB binary blobs per 1,000 bars) prevents network re-fetches.
2. **12 Reference Strategy Matrix**: Broadest coverage of edge conditions and Pine features.
3. **Automated Licensing Audit**: Scripted bundle verification checking that zero AGPL symbols leak into client distributions.
4. **Visual Spatial Indexing**: Quadtree / binary search hit-testing for trade marker hover detection.

#### Weaknesses & Disqualifying Errors
- **Fatal Polarity State Machine Error**: Formulated intrabar path based on `Close >= Open` rather than TradingView's verified wick proximity equation $|High - Open| \le |Open - Low|$.
- Did not address the microtask loop scheduling bottleneck in the historical bar execution loop.

---

## 5. Cross-Cutting Technical Synthesis & Architectural Directives

To guarantee that the implementation achieves complete production success, the engineering team must enforce five non-negotiable architectural invariants synthesized from the top candidates:

```mermaid
flowchart TD
    subgraph Host_Domain [Apache-2.0 Host Application & UI Shell]
        UI_Workspace[Vela Workspace Grid & Multi-Pane Layout]
        Chart_Renderer[Vela WebGL2 NativeRenderer + TradeMarkerLayer]
        Dock_Panel[3-State VelaBottomDock: Minimized / Split / Maximized]
        Strategy_Tester[Strategy Tester: Overview / 3-Col Summary / VirtualDataGrid]
        Monaco_Studio[Monaco Pine IDE: Monarch Grammar, Autocomplete, Diagnostics]
        Data_Pipeline[CachingDataFeed: L1 In-Memory + L2 IndexedDB Chunks]
    end

    subgraph IPC_Seam [Clean-Room Process Seam: postMessage & Transferable ArrayBuffers]
        RPC_Bridge[PineWorkerEngine Proxy: Zero-Copy Binary Buffers]
    end

    subgraph Engine_Domain [AGPL-3.0 Sandboxed Web Worker: pinets.worker.js]
        Worker_Host[Worker Host & Task Scheduler]
        AST_Pipeline[Transpiler: Lexer -> Indentation Parser -> AST -> JS]
        Sync_Loop[Synchronous Execution Loop: _executeIterationsSync]
        Columnar_Mem[Columnar FastSeries Storage: Float64Array Reverse Indexing]
        
        subgraph Broker_Kernel [TradingView Parity Broker Emulator: strategy/utils.ts]
            Precedence[Two-Phase Order Precedence: Open Gaps vs Intrabar Bounds]
            Polarity[4-Tick Wick Proximity: |H - O| <= |O - L| (isAdverseFirstBar)]
            FIFO_Split[Dual-Queue FIFO Ledger: opentrades vs _ledger_entries]
            Margin_Check[3-Point Margin Checkpoints: open / extreme / close + 4x Deficit]
            Metrics_Engine[Institutional Analytics: 30+ Metrics, MAE/MFE, TV DD% Denom]
        end
    end

    Data_Pipeline -->|Transferable Float64Array Buffers| RPC_Bridge
    Monaco_Studio -->|Pine Source Code| RPC_Bridge
    RPC_Bridge --> Worker_Host
    Worker_Host --> AST_Pipeline
    AST_Pipeline --> Sync_Loop
    Sync_Loop --> Columnar_Mem
    Columnar_Mem --> Broker_Kernel
    Broker_Kernel -->|IndicatorModel & TradeExecution[]| RPC_Bridge
    RPC_Bridge --> Chart_Renderer
    RPC_Bridge --> Strategy_Tester
    Strategy_Tester <-->|Cross-Probing Coordinator: Row Click <-> Pan/Zoom| Chart_Renderer
```

### 1. The Zero-Copy Columnar Memory Pipeline (from Candidate C)
Standard JavaScript object arrays (`{ time, open, high, low, close, volume }[]`) must be completely prohibited in the hot execution path.
- Market data must be held in 64-byte aligned `Float64Array` columnar buffers (`ColumnarBarTable`).
- Transfer to Web Workers must use `postMessage(msg, [time.buffer, open.buffer, ...])` achieving $< 1\text{ms}$ transfer for 100,000 bars.
- `Series.ts` lookbacks must be implemented via `FastSeries`, operating directly over continuous `Float64Array` slices with reverse cursor offsets `buffer[currentLength - 1 - Math.trunc(offset)]`.

### 2. The Synchronous Loop Unrolling Imperative (from Candidates C & D)
- The transpiler must statically inspect the Pine AST for asynchronous operations (`request.security`).
- If no async calls exist (or after secondary series are pre-fetched in pass 1), the generated JavaScript must be wrapped in a synchronous closure `(context) => { ... }`.
- Execution must run via `_executeIterationsSync`, eliminating millions of microtask Promise resolutions and dropping 10k-bar execution times below $5\text{ms}$.

### 3. The Inviolable AGPL-3.0 vs. Apache-2.0 Licensing Seam (from Candidates A & C)
- No AGPL-3.0 code from PineTS or Vela-pinets may be imported, bundled, or statically linked into the main UI thread.
- The AGPL engine must be compiled into an isolated Web Worker IIFE artifact (`pinets.worker.js`).
- The main thread communicates exclusively through the neutral `ScriptingEngine` interface passing plain serializable DTOs (`IndicatorModel`, `TradeExecution[]`, `StrategyState`).
- Automated CI tests must run `! grep -rn "PineTS" packages/shell/dist/` to verify zero copyleft leakage.

### 4. The 5 Non-Negotiable TradingView Broker Invariants (from Candidate C)
1. **Wick Proximity Polarity**: Intrabar price trajectory is governed strictly by $|High - Open| \le |Open - Low|$ (`isAdverseFirstBar`), never by candle body color (`Close >= Open`).
2. **Gap Fill Asymmetry**: Limit and stop orders gapping past the open fill at `Open`. Buy-stops already in-the-money at open spare fresh same-open entries (`buyStopSparesFreshEntry`).
3. **Dual-Queue FIFO Ledger**: Physical lots (`opentrades`) preserve immutable `_bracket_entry` prices for bracket tracking; ledger accounting (`_ledger_entries`) splits exits sequentially across consumed entry lots with pro-rata commissions.
4. **3-Checkpoint Margin Calls with 4x Deficit Cover**: Evaluate margin at `open`, `extreme`, and `close`. When equity breaches maintenance margin, liquidate $4 \times \text{Deficit}$ at the adverse extreme.
5. **Equity Latching & Drawdown Denominator**: Realized equity is latched at bar end (`finalizeStrategyBar`). Drawdown percentage is calculated against the equity peak at the moment of the latch event, not against initial capital.

### 5. Multi-Tier Persistent Data Engine (Incorporating Candidate E's Best Feature)
- Integrate Candidate E's two-tier caching architecture: L1 in-memory LRU `BarStore` (200k bars) backed by an L2 browser `IndexedDBBarStore` storing historical data in 1,000-bar compressed `Float64Array` chunks (48KB each). This eliminates redundant network queries when the user scrolls historical charts or tests multiple strategies on the same symbol.

---

## 6. Official Winner Selection & Next Steps

### Official Winner
**Candidate C (`candidate-C.md`)** is hereby declared the **Official Winning Plan** for the PineOrca platform.

### Synthesis & Harmonization Directives
While Candidate C provides the definitive architectural blueprint, the engineering implementation should incorporate four high-value enhancements from the other candidates:
1. **From Candidate A**: Incorporate the rich multi-tier compiler diagnostics catalog (`PineDiagnostic`), the AST loop iteration guards, the main-thread hardware watchdog timer, and the comprehensive drawing extensions (`table.new`, `box.new`, `polyline.new`).
2. **From Candidate B**: Incorporate the Bar Magnifier engine (`buildLtfSlices`, `resolveOrdersOnLtfSlice`) for true sub-minute tick simulation, and render dotted green/red connector lines for trade traces.
3. **From Candidate D**: Utilize Candidate D's explicit transpiler AST wrapper analysis (`WrapperTransformer.ts`) to cleanly bifurcate synchronous and asynchronous execution paths.
4. **From Candidate E**: Integrate the persistent L2 IndexedDB chunked storage engine to cache historical datasets locally in the browser.

### Action Plan & Phase 1 Execution
With the architectural contest settled, the team is directed to proceed immediately to **Phase 1 Implementation** following the unified Candidate C blueprint.
