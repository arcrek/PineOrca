# PineOrca Implementation Plan: Ultra Verifier Candidate B
**Rigorous Broker-Emulator Parity, Mathematical Correctness, WebGL2 Charting & TradingView-Style Strategy Tester**

---

## 1. Executive Summary & System Architecture

PineOrca is an institutional-grade, browser-native quantitative development and backtesting platform. It unifies high-performance Pine Script v5/v6 execution, bit-accurate broker emulation matching TradingView's execution semantics, and a responsive WebGL2 charting environment equipped with a TradingView-identical Strategy Tester and Pine Editor workspace.

### 1.1 Architectural Principles
1. **Mathematical & Execution Parity**: The broker emulator must reproduce TradingView's order matching lifecycle, intra-bar execution precedence, FIFO lot accounting, trailing stop arming/peaking, and margin liquidation checkpoints with zero numerical divergence.
2. **Off-Thread Zero-Jank Execution**: Pine transpilation, series memory allocations, and backtest iterations run exclusively in dedicated Web Workers. The UI thread remains dedicated to 60fps WebGL2 rendering and interactive user workflows.
3. **Clean Licensing Separation**: A strict IPC / Worker message boundary isolates AGPL-3.0 execution logic (PineTS transpiler and runtime) from Apache-2.0 UI components (Vela chart engine, Strategy Tester widgets, Monaco IDE wrapper), enabling modular host integration without licensing contamination.
4. **Columnar & Zero-Allocation Series**: Heavy numerical operations operate over flat typed buffers (`Float64Array`, `Int32Array`) with reverse-indexing cursor abstractions, preventing garbage collection pauses across 100,000+ bar datasets.

---

### 1.2 System Topology Diagram

```
+-------------------------------------------------------------------------------------------------------------------------+
|                                                  MAIN BROWSER THREAD                                                    |
|                                            (Apache-2.0 UI / Workspace Layer)                                            |
|                                                                                                                         |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|  |                                                 VelaWorkspace                                                     |  |
|  |  +-----------------------------------------------------------------------+  +----------------------------------+  |  |
|  |  |                     Vela WebGL2 / Canvas2D Multi-Pane                 |  |      PanelDock (Side Panels)     |  |  |
|  |  |  - Main Price Pane: Candles, Volume, In-Chart TradeExecution Markers  |  |  - Object Tree                   |  |  |
|  |  |  - Oscillator Sub-Panes: RSI, MACD, Stochastic Indicators              |  |  - Data Window / Inspector       |  |  |
|  |  |  - Visual Drawing Layer: Order Lines, Bracket Zones, PnL Callouts     |  |  - Indicator / Symbol Search     |  |  |
|  |  +-----------------------------------------------------------------------+  +----------------------------------+  |  |
|  |  |                                      Horizontal Draggable Splitter                                            |  |
|  |  +---------------------------------------------------------------------------------------------------------------+  |
|  |  |                                          BottomDock (Bottom Panel)                                            |  |
|  |  |  +-------------------------------------------------------+  +----------------------------------------------+  |  |
|  |  |  |                  Strategy Tester Dock                 |  |             Monaco Pine Editor Dock          |  |  |
|  |  |  |  - Tab 1: Overview (Equity Curve & Drawdown Chart)    |  |  - Pine v5/v6 Monarch Grammar / Highlighting |  |  |
|  |  |  |  - Tab 2: Performance Summary (26-Metric Matrix)     |  |  - AST Semantic Diagnostics & Inline Errors   |  |  |
|  |  |  |  - Tab 3: List of Trades (Virtualized Interactive Grid)|  |  - "Add / Update to Chart" Action Dispatch |  |  |
|  |  |  +-------------------------------------------------------+  +----------------------------------------------+  |  |
|  |  +---------------------------------------------------------------------------------------------------------------+  |
|  |  |                                      Bottombar (Presets, Timezone, Session)                                   |  |
|  +--+---------------------------------------------------------------------------------------------------------------+--+  |
|                                                         |                                                               |
|                                       ScriptingEngine Plugin Interface                                                  |
|                                                         |                                                               |
|                                             PineWorkerEngine (Proxy)                                                    |
|                                                         |                                                               |
+---------------------------------------------------------|---------------------------------------------------------------+
                                                          |
                                      Transferable ArrayBuffers & postMessage
                                      (Bidirectional IPC Protocol: protocol.ts)
                                                          |
+---------------------------------------------------------v---------------------------------------------------------------+
|                                              DEDICATED WEB WORKER THREAD                                                |
|                                                (AGPL-3.0 Engine Core)                                                   |
|                                                                                                                         |
|  +-------------------------------------------------------------------------------------------------------------------+  |
|  |                                                   worker.ts                                                       |  |
|  |  +----------------------------------+  +-----------------------------------------------------------------------+  |  |
|  |  |       Transpilation Pipeline     |  |                      PineRuntime Stateful Core                        |  |  |
|  |  |  - Lexer & Parser (Pine -> AST)  |  |  - Series Buffer Management (Series.ts: typed array + reverse cursor) |  |  |
|  |  |  - AST Analyzer Pass             |  |  - Stateful TA Library (ta.sma, ta.ema, ta.rsi, ta.macd, ta.atr)       |  |  |
|  |  |  - JS Code Generator             |  |  - Synchronous Execution Loop (_executeIterationsSync)               |  |  |
|  |  +----------------------------------+  +-----------------------------------------------------------------------+  |  |
|  |                                        |                    TV-Parity Broker Emulator Engine                   |  |  |
|  |                                        |  - Two-Phase Fill Precedence (Open Gap-Fills vs Intrabar Crossings)   |  |  |
|  |                                        |  - Intrabar Traversal (Polarity Heuristic vs Bar Magnifier LTF Slices)|  |  |
|  |                                        |  - FIFO Lot Liquidator & Multi-Bracket OCA Exit Resolver              |  |  |
|  |                                        |  - Margin Liquidation Checkpoints & Partial Reduction (4x Deficit)    |  |  |
|  |                                        |  - Quantitative Financial Analytics (MAE, MFE, Sharpe, Sortino, CAGR) |  |  |
|  |                                        +-----------------------------------------------------------------------+  |  |
|  +-------------------------------------------------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------------------------------------------------+
```

---

### 1.3 Component Interaction & Data Flow Lifecycle

```
User Action: "Apply Strategy" or "Update Chart"
   │
   ▼
[Monaco Editor] ────> Transmit Source Code + User Inputs ────> [PineWorkerEngine Proxy]
                                                                        │
                                                     postMessage({ kind: 'prepare', source })
                                                                        ▼
                                                         [Web Worker: Lexer / Parser]
                                                                        │
                                                         Transpile to Executable JS
                                                                        │
                                                         Resolve Declaration Metadata
                                                                        ▼
                                                   [PineWorkerEngine] <── postMessage('prepared')
                                                           │
                                      Request OHLCV Data from MultiProviderFeed
                                                           │
                                      postMessage({ kind: 'run', bars: TransferableBuffers })
                                                           ▼
                                               [Web Worker: Execution Loop]
                                                           │
                                ┌──────────────────────────┴──────────────────────────┐
                                ▼                                                     ▼
                     [Series & TA Engine]                                    [Broker Emulator]
                 Incremental TA Calculations                         Two-Phase Order Precedence
                 (ta.ema, ta.rsi, drawings)                          FIFO Multi-Lot Ledger
                                                                     Intrabar Traversal (Polarity/LTF)
                                                                     Margin Call Checkpoints
                                                                     MAE, MFE, Sharpe, Sortino
                                └──────────────────────────┬──────────────────────────┘
                                                           │
                                      Assemble Scene Graph & Execution Results:
                                      - IndicatorModel (series, plots, fills, drawings)
                                      - TradeExecution[] (merged chart markers)
                                      - StrategyAnalyticsSnapshot (26 performance metrics)
                                      - TradeRecord[] (closed/open trades with MAE/MFE)
                                                           │
                                      postMessage({ kind: 'model' }, { kind: 'strategyState' })
                                                           ▼
                                               [PineWorkerEngine Proxy]
                                                           │
                                ┌──────────────────────────┴──────────────────────────┐
                                ▼                                                     ▼
                     [Vela Chart Surface]                                  [BottomDock: Strategy Tester]
                 Render WebGL2 Candles & Panes                         Overview: Render Equity & DD Curves
                 Overlay TradeExecution Markers                        Summary: Populate 26-Metric Grid
                 Connect Entry-to-Exit Trace Lines                     Trades: Virtualized Interactive Grid
                                                                       Row Click -> Synchronize Chart Pan/Zoom
```

---

### 1.4 Licensing Architecture & Clean Isolation

The platform enforces strict licensing compliance to allow commercial deployment of the charting UI and client applications:
- **AGPL-3.0 Boundary (Engine Realm)**: The transpiler (`PineTS/src/transpiler`), Pine runtime (`PineTS/src/Series.ts`, `ta.*`), and broker emulator (`PineTS/src/namespaces/strategy`) are licensed under AGPL-3.0. In PineOrca, these modules are strictly compiled into an isolated Web Worker bundle (`pine-worker.bundle.js`).
- **Apache-2.0 / MIT Boundary (Client UI Realm)**: The charting library (`Vela`), the workspace shell (`VelaWorkspace`), the Strategy Tester UI components, and the Monaco Editor integration contain zero AGPL dependencies.
- **Inter-Process Communication Protocol**: Communication between UI and Worker occurs exclusively across the standardized `postMessage` protocol (`protocol.ts`). No AGPL internal classes or types leak across the IPC boundary. The UI consumes plain JSON-serializable DTOs (`IndicatorModel`, `TradeExecution[]`, `StrategySummaryDTO`, `TradeDetailDTO`).

---

## 2. Rigorous Broker-Emulator Parity & Mathematical Engine Specification

### 2.1 Bar Lifecycle & Order Execution Precedence Model

TradingView evaluates strategies on historical bars at bar close, queuing orders for execution on subsequent bars. PineOrca implements the exact two-phase lifecycle per bar $t$:

```
                                      BAR t LIFECYCLE
                                             │
                                             ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ 1. PHASE 'OPEN' (Immediate Bar Open Resolution)                                     │
  │    a. Conditional-Exit Gap Fills:                                                   │
  │       - Check all pending SL/TP/Trailing orders armed on bar t-1.                   │
  │       - If Open_t gaps beyond trigger price:                                        │
  │         * Long SL: Open_t <= StopPrice -> Fill at Open_t (gap slip).                │
  │         * Long TP: Open_t >= LimitPrice -> Fill at Open_t (favorable gap).          │
  │         * Short SL: Open_t >= StopPrice -> Fill at Open_t.                          │
  │         * Short TP: Open_t <= LimitPrice -> Fill at Open_t.                         │
  │       - Consumed orders are removed; they do NOT participate in intrabar checks.     │
  │    b. Market Order Fills:                                                           │
  │       - Process market orders placed at close of bar t-1.                           │
  │       - Fill Price = Open_t + SlippageAdjustment.                                   │
  │    c. Pre-Trade Margin & Risk Validation:                                           │
  │       - Verify available equity >= required initial margin.                         │
  │       - If margin deficit: reject entry or trigger partial fill.                    │
  └──────────────────────────────────┬──────────────────────────────────────────────────┘
                                     │
                                     ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ 2. PHASE 'INTRABAR' (Price Traversal & Crossings)                                   │
  │    a. Traversal Path Determination:                                                 │
  │       - If Bar Magnifier disabled: Compute Polarity Heuristic (Open -> H/L -> L/H). │
  │       - If Bar Magnifier enabled: Load LTF sub-bars (1m/1s) for Bar t.              │
  │    b. Step-by-Step Path Traversal:                                                  │
  │       - For each sub-step: evaluate Stops, Limits, and Trailing Stops.              │
  │       - OCO / OCA Group Resolution: First executed leg immediately cancels others.  │
  │       - Intrabar Margin Liquidation Checkpoint:                                     │
  │         * Evaluate at adverse extreme (Low for Longs, High for Shorts).             │
  │         * If Equity < Maintenance Margin: execute emergency partial liquidation.    │
  └──────────────────────────────────┬──────────────────────────────────────────────────┘
                                     │
                                     ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ 3. PHASE 'CLOSE' (Bar Completion & Strategy Logic)                                  │
  │    a. Post-Intrabar Margin Check: Final solvency check at Close_t.                  │
  │    b. Excursion Bookkeeping: Update MFE/MAE for all currently open trades.          │
  │    c. Script Execution: Run compiled Pine Script user logic for Bar t.              │
  │    d. Order Emission: strategy.entry(), exit(), order(), close() queue orders for   │
  │       Bar t+1.                                                                      │
  └─────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 2.2 Intra-Bar Crossing Resolution: Polarity Heuristics vs Bar Magnifier

#### 2.2.1 Synthetic 4-Point Polarity Heuristic
When tick or lower-timeframe (LTF) data is unavailable, TradingView estimates the intra-bar sequence using the bar open's proximity to the extremes:

$$\Delta_{\text{High}} = |\text{High}_t - \text{Open}_t|, \quad \Delta_{\text{Low}} = |\text{Open}_t - \text{Low}_t|$$

1. **Open Closer to High** ($\Delta_{\text{High}} \le \Delta_{\text{Low}}$):
   - Assumed Path: $\text{Open}_t \longrightarrow \text{High}_t \longrightarrow \text{Low}_t \longrightarrow \text{Close}_t$.
   - **For Long Positions**: The initial move ($\text{Open} \to \text{High}$) is **favorable**. Take Profit triggers before Stop Loss if both target levels fall within $[\text{Low}_t, \text{High}_t]$.
   - **For Short Positions**: The initial move is **adverse**. Stop Loss triggers before Take Profit.
2. **Open Closer to Low** ($\Delta_{\text{High}} > \Delta_{\text{Low}}$):
   - Assumed Path: $\text{Open}_t \longrightarrow \text{Low}_t \longrightarrow \text{High}_t \longrightarrow \text{Close}_t$.
   - **For Long Positions**: The initial move is **adverse**. Stop Loss triggers before Take Profit.
   - **For Short Positions**: The initial move is **favorable**. Take Profit triggers before Stop Loss.

#### 2.2.2 Bar Magnifier Engine (`use_bar_magnifier = true`)
The Bar Magnifier eliminates synthetic heuristic ambiguity by resolving intra-bar order fills on lower timeframe bars (e.g., 1-minute bars during a 1-day or 1-hour backtest):
1. **Time-Slicing Window**: For higher timeframe (HTF) bar $t$ spanning $[T_{\text{start}}, T_{\text{end}}]$, retrieve LTF bars $B^{\text{LTF}}_{1 \dots k}$ where $T_{\text{start}} \le \text{time}(B^{\text{LTF}}_i) \le T_{\text{end}}$.
2. **Sequential Micro-Evaluation**: Pending orders are evaluated against each $B^{\text{LTF}}_i$ using the 4-point traversal of the LTF bar.
3. **Execution Timestamping**: Fills are timestamped at the exact millisecond and price of the triggering LTF sub-bar, ensuring 100% execution authenticity.

---

### 2.3 FIFO Lot Matching, Pyramiding, and Reversals

TradingView operates an accounting ledger governed strictly by First-In, First-Out (FIFO) lot rules:
- **Open Lot Ledger**: Each executed entry creates a discrete lot:
  $$\mathcal{L}_i = \langle \text{id}, \text{entry\_bar}, \text{entry\_time}, \text{entry\_price}, \text{size}, \text{remaining\_qty}, \text{commission\_paid} \rangle$$
- **FIFO Liquidation Sequence**: When an exit order of quantity $Q_{\text{exit}}$ fills:
  1. Retrieve active lots ordered by `entry_time` ascending.
  2. Deduct fill quantity from the oldest lot $\mathcal{L}_0$.
  3. If $Q_{\text{exit}} \ge \mathcal{L}_0.\text{remaining\_qty}$, close $\mathcal{L}_0$ entirely, record its closed trade record with realized PnL, and decrement $Q_{\text{exit}}$ by $\mathcal{L}_0.\text{remaining\_qty}$.
  4. Repeat until $Q_{\text{exit}} = 0$.
- **Position Reversals**: When an entry order reverses the current market direction (e.g., holding $+5$ contracts Long, receiving order `strategy.entry("Short", strategy.short, qty=10)`):
  - **Leg 1 (Close Existing)**: Automatically generates an internal fill closing 5 Long contracts at the execution price, neutralizing the position to 0 and calculating closed trade PnL.
  - **Leg 2 (Open Reverse)**: Opens a new Short position with 5 contracts at the same fill price.
  - On the chart, this renders as a single combined execution marker labeled with the new entry's direction and full order size (10 contracts).

---

### 2.4 Exit Brackets, OCA/OCO Groups, and Trailing Stops

#### 2.4.1 OCA / OCO Bracket Dynamics
Exit orders tied to a position via `strategy.exit(id, from_entry, limit, stop, trail_points, trail_offset)` form an OCA (One-Cancels-All) / OCO (One-Cancels-Other) bracket:
- When the `limit` (Take Profit) fills, the paired `stop` and `trailing stop` legs are instantly cancelled.
- If multiple brackets target the same entry, partial fills decrement the parent lot quantity proportionally.

#### 2.4.2 Trailing Stop Mechanics
A trailing stop tracks favorable price action and tightens its stop price:
1. **Arming Phase**: If `trail_points` or `trail_price` is specified, the trailing stop remains inactive until price reaches the activation threshold:
   - Long: $\text{High}_t \ge \text{ArmingPrice}$
   - Short: $\text{Low}_t \le \text{ArmingPrice}$
2. **Peak Tracking Phase**: Once armed, the emulator tracks the peak favorable extreme:
   $$\text{Peak}_{\text{Long}} = \max(\text{Peak}_{\text{Long}}, \text{High}_t), \quad \text{Peak}_{\text{Short}} = \min(\text{Peak}_{\text{Short}}, \text{Low}_t)$$
3. **Stop Trigger Level Calculation**:
   $$\text{StopLevel}_{\text{Long}} = \text{Peak}_{\text{Long}} - (\text{trail\_offset} \times \text{mintick})$$
   $$\text{StopLevel}_{\text{Short}} = \text{Peak}_{\text{Short}} + (\text{trail\_offset} \times \text{mintick})$$
4. **Intrabar Arming & Triggering**: If a trailing stop is armed on the current bar, it can only trigger on subsequent price moves within that bar according to the determined polarity path.

---

### 2.5 Margin Maintenance, Checkpoints, and Partial Liquidation Dynamics

TradingView enforces margin requirements to prevent account equity from dropping below maintenance thresholds.

#### 2.5.1 Margin Equations
- **Required Maintenance Margin**:
  $$\mathcal{M}_{\text{held}}(P) = \sum_{l \in \text{OpenLots}} |l.\text{qty}| \times P \times \text{pointValue} \times \left( \frac{\text{margin\_percent}}{100} \right)$$
- **Mark-to-Market Equity**:
  $$\mathcal{E}(P) = \text{InitialCapital} + \text{NetProfit}_{\text{realized}} + \sum_{l \in \text{OpenLots}} \text{Direction}_l \times (P - l.\text{entry\_price}) \times |l.\text{qty}| \times \text{pointValue}$$

#### 2.5.2 Checkpoint Evaluations & The 4x Deficit Liquidation Rule
A margin call occurs whenever:
$$\mathcal{E}(P) < \mathcal{M}_{\text{held}}(P)$$

1. **Evaluation Checkpoints**:
   - **Checkpoint 1 (Intrabar Adverse Extreme)**: Evaluated at $\text{Low}_t$ for net Long positions or $\text{High}_t$ for net Short positions.
   - **Checkpoint 2 (Bar Close)**: Re-evaluated at $\text{Close}_t$.
2. **Partial Liquidation Algorithm**:
   To emulate real-world exchange liquidations without needlessly closing 100% of a portfolio, TradingView liquidates lots in chunks proportional to the deficit:
   $$\text{Deficit} = \mathcal{M}_{\text{held}}(P) - \mathcal{E}(P)$$
   $$\text{LiquidationTargetValue} = 4 \times \text{Deficit}$$
   - The emulator liquidates oldest open lots until the liquidated nominal value satisfies $\text{LiquidationTargetValue}$ or the account becomes fully solvent.
   - If `margin_percent = 0` (or 100% margin call rule configured), the entire position is liquidated immediately at the checkpoint price.

---

### 2.6 Quantitative Performance Analytics & Financial Metrics Formulation

PineOrca implements a comprehensive 26-metric analytics engine matching TradingView's Strategy Tester reports:

| Metric Name | Mathematical Definition | Explanation |
| :--- | :--- | :--- |
| **Net Profit** | $NP = \sum \text{PnL}_{\text{closed}} + \text{UnrealizedPnL} - \text{Commissions}$ | Total bottom-line return in base currency and %. |
| **Gross Profit** | $GP = \sum_{T \in \text{Winners}} \text{PnL}_T$ | Total gains from all winning trades. |
| **Gross Loss** | $GL = \sum_{T \in \text{Losers}} |\text{PnL}_T|$ | Total losses from all losing trades. |
| **Profit Factor** | $PF = \frac{GP}{GL}$ (if $GL = 0$, $PF = \infty$) | Ratio of gross profit to gross loss. |
| **Max Drawdown ($ & %)** | $MDD = \max_{\tau \le t} (\text{PeakEquity}_\tau - \text{Equity}_t)$ | Maximum peak-to-trough decline across all bars. |
| **Max Run-Up ($ & %)** | $MRU = \max_t (\text{Equity}_t - \text{TroughEquity}_t)$ | Maximum trough-to-peak run-up across the backtest. |
| **MAE (Max Adverse Excursion)** | $\text{MAE}_T = \min_{t \in T} (\text{UnrealizedPnL}_t - \text{EntryCommission})$ | Peak paper loss suffered by trade $T$ while open. |
| **MFE (Max Favorable Excursion)**| $\text{MFE}_T = \max_{t \in T} (\text{UnrealizedPnL}_t - \text{EntryCommission})$ | Peak paper profit achieved by trade $T$ while open. |
| **Sharpe Ratio** | $S = \frac{\bar{R}_d - R_f}{\sigma_d} \times \sqrt{252}$ (or $\sqrt{N_{\text{bars/yr}}}$) | Excess return per unit of total risk (standard deviation). |
| **Sortino Ratio** | $So = \frac{\bar{R}_d - R_{\text{target}}}{\sigma_{\text{downside}}} \times \sqrt{252}$ | Return penalized exclusively by downside volatility. |
| **Downside Deviation** | $\sigma_{\text{downside}} = \sqrt{\frac{1}{N}\sum_{i=1}^N \min(0, R_i - R_{\text{target}})^2}$ | Standard deviation of negative returns only. |
| **CAGR** | $\text{CAGR} = \left(\frac{\mathcal{E}_{\text{final}}}{\mathcal{E}_{\text{initial}}}\right)^{\frac{365.25}{\text{Days}}} - 1$ | Compound Annual Growth Rate over the span. |
| **Buy & Hold Return** | $B\&H = \frac{\text{Close}_{\text{last}} - \text{Close}_{\text{first}}}{\text{Close}_{\text{first}}} \times 100\%$ | Return achieved by holding the benchmark asset. |
| **Strategy Outperformance**| $\Delta_{\text{perf}} = NP_{\%} - B\&H_{\%}$ | Alpha generated over simple buy-and-hold. |
| **Win Rate (% Profitable)** | $WR = \frac{N_{\text{wins}}}{N_{\text{total}}} \times 100\%$ | Percentage of winning trades. |
| **Avg Trade** | $\overline{T} = \frac{NP}{N_{\text{total}}}$ | Average expected return per executed trade. |
| **Avg Win / Avg Loss Ratio** | $\text{Ratio} = \frac{\overline{\text{Win}}}{\overline{\text{Loss}}}$ | Average payoff ratio per trade. |
| **Max Consecutive Wins/Losses** | $\max(\text{Count}_{\text{consecutive}})$ | Risk metric for clustering and streaks. |
| **Avg Bars in Trade** | $\overline{B} = \frac{1}{N}\sum (\text{ExitBar}_T - \text{EntryBar}_T)$ | Capital velocity metric (split Long vs Short). |
| **Margin Calls Count** | $N_{\text{MC}} = \sum \mathbb{I}(\text{MarginCallEvent})$ | Total number of emergency margin interventions. |

---

## 3. TradingView-Style UI & Vela WebGL2 Integration Specification

### 3.1 Vela Workspace Layout & Bottom Panel Dock Architecture

The PineOrca UI embeds inside `VelaWorkspace` as a top-level dockable component below the multi-pane chart grid:

```
+----------------------------------------------------------------------------------------------------+
| Topbar: [AAPL, 1D] [Indicators v] [Undo] [Redo]                          [Settings] [Layout v]     |
+----------------------------------------------------------------------------------------------------+
|                                                                     |                              |
|                                Vela WebGL2 Chart Surface            |      SidePanelDock           |
|                                                                     |      - Object Tree           |
|                                                                     |      - Data Window           |
|                                                                     |                              |
+=====================================================================+==============================+
| [^] [v] [x]  HORIZONTAL SPLITTER (Drag to resize bottom dock)                                      |
+----------------------------------------------------------------------------------------------------+
| [ Strategy Tester ] [ Pine Editor ] [ Pine Console ]                           [Export CSV] [_] [^]|
|----------------------------------------------------------------------------------------------------|
|   ( ) Overview         (*) Performance Summary         ( ) List of Trades                          |
|----------------------------------------------------------------------------------------------------|
|  Metric                     All Trades                Long Trades               Short Trades       |
|  ------------------------------------------------------------------------------------------------- |
|  Net Profit                 $142,520.50 (+142.5%)     $98,210.00 (+98.2%)       $44,310.50 (+44.3%)|
|  Gross Profit               $285,100.00               $180,400.00               $104,700.00        |
|  Gross Loss                 -$142,579.50              -$82,190.00               -$60,389.50        |
|  Profit Factor              2.00                      2.19                      1.73               |
|  Max Drawdown               -$24,150.00 (12.4%)       -$16,200.00 (9.1%)        -$12,400.00 (7.8%) |
|  Buy & Hold Return          $45,200.00 (+45.2%)       --                        --                 |
|  Sharpe Ratio               1.84                      1.92                      1.61               |
|  Sortino Ratio              2.65                      2.81                      2.24               |
|  Total Closed Trades        248                       152                       96                 |
|  Percent Profitable         58.47%                    61.18%                    54.17%             |
+----------------------------------------------------------------------------------------------------+
| Bottombar: [1D] [5D] [1M] [3M] [1Y] [5Y] [All]           UTC+0 | Regular Hours                     |
+----------------------------------------------------------------------------------------------------+
```

---

### 3.2 In-Chart Visual Trade Markers (`TradeExecution`)

Executed orders render directly on the Vela WebGL2/Canvas2D price pane using the native `TradeExecution` primitive (`Vela/src/core/model/trades.ts`):

```typescript
export interface TradeExecution {
    time: number;          // UTC Epoch timestamp matching the fill bar
    price: number;         // Exact fill price
    side: 'buy' | 'sell';  // 'buy' -> upward arrow below bar; 'sell' -> downward arrow above bar
    kind: 'entry' | 'exit';// Shape variant and visual styling
    label?: string;        // Order identifier or comment (e.g. "Buy Stop @ 150.00")
    qty?: number;          // Executed position size
    tradeId?: string;      // Correlating trade identifier
}
```

1. **Trade Trace Lines**: Dotted connector lines connect each entry marker to its corresponding exit marker:
   - Green dotted line for winning trades ($PnL > 0$).
   - Red dotted line for losing trades ($PnL < 0$).
2. **Interactive Hover Tooltip**: Hovering an on-chart trade execution marker displays an inspection card:
   - Trade ID, Entry Time & Price, Exit Time & Price.
   - Realized PnL ($ and %), Cumulative Capital.
   - Per-Trade MAE (Max Adverse Excursion) and MFE (Max Favorable Excursion).

---

### 3.3 Strategy Tester Component Hierarchy & UX Specifications

The Strategy Tester bottom panel is composed of three tabs:

#### 1. Overview Tab
- **Equity Curve Canvas**: Dual-series interactive chart plotting cumulative equity ($\mathcal{E}_t$) against the Buy & Hold equity benchmark over time.
- **Drawdown Area Chart**: Inverted underwater area chart depicting percentage drawdown from all-time highs on every bar.
- **Synchronized Cursor Crosshair**: Hovering over the equity curve displays a vertical crosshair synchronized with the main Vela candlestick chart.

#### 2. Performance Summary Tab
- **TradingView 3-Column Layout**: Strict tabular breakdown comparing **All Trades**, **Long Trades**, and **Short Trades** across the 26 canonical financial metrics.
- **Format Consistency**: Currency values formatted with thousand separators, percentages with 2 decimal places, ratios with 2 decimal precision.

#### 3. List of Trades Tab
- **Virtualized High-Performance Grid**: Virtual scrolling rendering thousands of trades smoothly at 60fps.
- **Columns**: Trade #, Type (Entry/Exit Long/Short), Signal Name, Date/Time, Price, Contracts, Profit ($ & %), Cumulative Profit, Run-Up (MFE), Drawdown (MAE).
- **Interactive Chart Teleportation**: Clicking any trade row triggers `chart.panToTime(trade.entry_time)` and pulses the on-chart entry/exit execution markers.

---

### 3.4 Embedded Monaco Pine Editor & Diagnostic Language Server

- **Custom Monarch Tokenizer**: Full Pine Script v5/v6 syntax highlighting (keywords, functions, namespaces `ta.*`, `strategy.*`, `request.*`, annotations `//@version=5`).
- **Autocompletion & Hover Tooltips**: IntelliSense documentation for all built-in functions, parameter signatures, and return types.
- **Inline Compilation Diagnostics**: Compilation errors and warnings generated by the PineTS lexer/parser are mapped to Monaco line/column markers with red squiggly underlines.
- **One-Click Hot Reloading**: `Ctrl+Enter` / `Cmd+Enter` instantly dispatches source updates to `PineWorkerEngine`, triggering off-thread execution and live chart re-rendering.

---

## 4. Phased Implementation Roadmap

### Phase 1: Broker Emulator Core & Order Precedence Hardening
**Goal**: Ensure bit-accurate order execution precedence, gap fills at open, intrabar polarity resolution, FIFO lot liquidation, and OCO bracket cancellation.

- **Files to Create / Modify**:
  - `packages/pine-engine/src/strategy/types.ts` (Extend `StrategyState`, `Order`, `Trade`, `Lot` definitions)
  - `packages/pine-engine/src/strategy/orderPrecedence.ts` (Implement two-phase fill engine)
  - `packages/pine-engine/src/strategy/fifoLedger.ts` (Implement strict FIFO lot queue and matching)
  - `packages/pine-engine/src/strategy/exitBrackets.ts` (Implement OCA/OCO cancel groups and trailing stops)
  - `packages/pine-engine/test/order-precedence.test.ts` (Comprehensive precedence unit tests)
  - `packages/pine-engine/test/fifo-ledger.test.ts` (Multi-lot FIFO matching verification)

- **Step-by-Step Implementation Tasks**:
  1. Define discrete `Lot` structure with `remaining_qty`, `entry_price`, `entry_time`, and commission tracking.
  2. Implement `processOpenPhaseOrders()`:
     - Scan pending exits for open price gap crossings and fill at `Open_t`.
     - Execute market orders at `Open_t` with configured slippage.
  3. Implement `processIntrabarOrders()` with synthetic polarity path generator:
     - Evaluate `openCloserToHigh = Math.abs(high - open) <= Math.abs(open - low)`.
     - Traverse path: `Open -> High -> Low -> Close` or `Open -> Low -> High -> Close`.
     - Test limit and stop trigger conditions in exact path sequence.
  4. Implement trailing stop state machine:
     - Track `trail_armed` state and dynamic `trail_peak` updates.
  5. Implement `resolveFifoClose()`:
     - Match outgoing exit quantity sequentially against oldest open lots.
     - Split partially closed lots without mutating historical references.

- **Verification Commands**:
  ```bash
  # Run targeted broker emulator precedence and FIFO tests
  npx vitest run packages/pine-engine/test/order-precedence.test.ts
  npx vitest run packages/pine-engine/test/fifo-ledger.test.ts
  ```

---

### Phase 2: Bar Magnifier & Intra-Bar Crossing Engine
**Goal**: Integrate lower-timeframe (LTF) historical bar slicing to resolve intra-bar order fills at true tick/sub-bar resolution.

- **Files to Create / Modify**:
  - `packages/pine-engine/src/slicing/barMagnifier.ts` (LTF series time-slicing and bar alignment)
  - `packages/pine-engine/src/strategy/intrabarResolver.ts` (Switch between polarity heuristic and LTF slice traversal)
  - `packages/pine-engine/test/bar-magnifier.test.ts` (Unit tests verifying 1m resolution within 1D bars)

- **Step-by-Step Implementation Tasks**:
  1. Implement `buildLtfSlices(htfBars, ltfBars)` to binary-search and bucket LTF bars into HTF bar intervals.
  2. Implement `resolveOrdersOnLtfSlice(pendingOrders, ltfSlice)`:
     - Step through each 1-minute sub-bar sequentially.
     - Evaluate stops and limits at the exact 1-minute bar OHLC prices.
     - Record execution timestamp from the sub-bar timestamp.
  3. Wire `use_bar_magnifier` strategy option to route execution between heuristic polarity and LTF slicing.

- **Verification Commands**:
  ```bash
  npx vitest run packages/pine-engine/test/bar-magnifier.test.ts
  ```

---

### Phase 3: Comprehensive Financial Analytics Engine & Quantitative Metrics
**Goal**: Implement the complete 26-metric quantitative engine including MAE, MFE, Sharpe, Sortino, CAGR, Max Drawdown %, and Buy & Hold benchmarks.

- **Files to Create / Modify**:
  - `packages/pine-engine/src/analytics/metrics.ts` (Financial calculation functions)
  - `packages/pine-engine/src/analytics/excursions.ts` (Intrabar trade-level MAE/MFE tracking)
  - `packages/pine-engine/src/analytics/returns.ts` (Periodic returns, Sharpe, and Sortino calculations)
  - `packages/pine-engine/src/strategy/marginCheckpoints.ts` (Margin maintenance and 4x deficit partial liquidation)
  - `packages/pine-engine/test/analytics-metrics.test.ts` (Verification against TradingView golden reference values)
  - `packages/pine-engine/test/margin-liquidation.test.ts` (Margin call and partial liquidation tests)

- **Step-by-Step Implementation Tasks**:
  1. Implement intrabar MAE and MFE tracking:
     - On every bar, evaluate each open trade's unrealized paper PnL at the bar's `High` and `Low`.
     - Net entry commissions from excursions to match TradingView standards.
  2. Implement annualized Sharpe and Sortino ratios:
     - Calculate periodic daily returns from the equity curve.
     - Compute downside risk deviation penalizing only negative return deviations.
  3. Implement CAGR calculation accounting for exact calendar leap years (365.25 days).
  4. Implement margin maintenance checking:
     - Check solvency at adverse extreme and bar close.
     - Liquidate oldest lots in 4x deficit increments when equity drops below required margin.

- **Verification Commands**:
  ```bash
  npx vitest run packages/pine-engine/test/analytics-metrics.test.ts
  npx vitest run packages/pine-engine/test/margin-liquidation.test.ts
  ```

---

### Phase 4: High-Throughput Dedicated Web Worker Engine & Streaming Protocol
**Goal**: Build the dedicated Web Worker host with Transferable array serialization, zero-copy buffer transfers, and live market streaming.

- **Files to Create / Modify**:
  - `packages/pine-worker/src/protocol.ts` (Typed bidirectional IPC message definitions)
  - `packages/pine-worker/src/worker.ts` (Worker loop, compilation cache, execution runner)
  - `packages/pine-worker/src/PineWorkerEngine.ts` (Main-thread client proxy implementing `ScriptingEngine`)
  - `packages/pine-worker/test/worker-protocol.test.ts` (IPC lifecycle and stress tests)

- **Step-by-Step Implementation Tasks**:
  1. Define message schemas in `protocol.ts`:
     - `prepare`: Source code transpilation request.
     - `execute`: Backtest execution request carrying columnar OHLCV Transferable typed arrays.
     - `model`: Response carrying scene graph models and `TradeExecution[]`.
     - `strategyReport`: Response carrying 26-metric analytics and trade history.
  2. In `worker.ts`, wrap `_executeIterationsSync` to stream progress events for large datasets (>50,000 bars).
  3. Implement live incremental streaming handle (`pine.stream`) updating only the active forming bar upon tick arrival.

- **Verification Commands**:
  ```bash
  npx vitest run packages/pine-worker/test/worker-protocol.test.ts
  ```

---

### Phase 5: Vela WebGL2 Chart Integration & Trade Execution Markers
**Goal**: Render visual trade execution markers, directional arrows, and connector lines on the Vela chart surface.

- **Files to Create / Modify**:
  - `packages/vela-ui/src/markers/tradeMarkers.ts` (Map `TradeExecution[]` to Vela chart markers)
  - `packages/vela-ui/src/markers/tradeTraces.ts` (Render entry-to-exit dotted connector lines)
  - `packages/vela-ui/src/markers/tradeTooltip.ts` (Interactive hover inspection card)
  - `packages/vela-ui/test/trade-markers.test.ts` (Marker generation and coordinate translation tests)

- **Step-by-Step Implementation Tasks**:
  1. Map `TradeExecution` items to Vela `Marker` primitives:
     - Buy Entry: Green upward triangle below candle low.
     - Sell Entry: Red downward triangle above candle high.
     - Exit: Small square or exit cross at fill price.
  2. Implement `TradeTracesLayer` on the WebGL2 canvas to render dotted lines connecting trade entry and exit coordinates.
  3. Wire mouse interaction to display trade details tooltip on hover.

- **Verification Commands**:
  ```bash
  npx vitest run packages/vela-ui/test/trade-markers.test.ts
  ```

---

### Phase 6: Dockable TradingView-Style Strategy Tester Panel & Monaco Editor
**Goal**: Build the dockable bottom panel hosting the 3-tab Strategy Tester and Monaco Pine Script editor.

- **Files to Create / Modify**:
  - `packages/vela-ui/src/bottomdock/BottomDock.ts` (Collapsible, resizable bottom dock container)
  - `packages/vela-ui/src/tester/StrategyTester.ts` (Tabbed container for Overview, Summary, and Trades)
  - `packages/vela-ui/src/tester/OverviewTab.ts` (Dual-canvas equity curve & drawdown area chart)
  - `packages/vela-ui/src/tester/PerformanceSummaryTab.ts` (26-metric 3-column performance table)
  - `packages/vela-ui/src/tester/ListOfTradesTab.ts` (Virtualized interactive trade list)
  - `packages/vela-ui/src/editor/MonacoPineEditor.ts` (Monaco Pine v5/v6 editor with language definition)
  - `packages/vela-ui/test/strategy-tester.test.ts` (DOM layout and tab switching tests)

- **Step-by-Step Implementation Tasks**:
  1. Construct `BottomDock` below `.vela-ws-main` with a vertical drag handle for resizing.
  2. Implement `OverviewTab`:
     - Render high-DPI canvas for cumulative equity curve and benchmark curve.
     - Render synchronized crosshair linking hover position to the main chart.
  3. Implement `PerformanceSummaryTab`:
     - Render 3-column table formatted to match TradingView layout.
  4. Implement `ListOfTradesTab`:
     - Virtualize trade rows using a lightweight DOM recycler.
     - On row click, trigger `chart.panToTime(trade.entry_time)`.
  5. Integrate `MonacoPineEditor`:
     - Register Monarch grammar for Pine Script syntax.
     - Bind `Ctrl+Enter` / `Cmd+Enter` to dispatch strategy compilation to `PineWorkerEngine`.

- **Verification Commands**:
  ```bash
  npx vitest run packages/vela-ui/test/strategy-tester.test.ts
  ```

---

## 5. Testing Strategy & Parity Verification Matrix

### 5.1 Automated Parity Verification Pipeline

The automated verification pipeline continuously asserts parity between PineOrca and TradingView:

```
[Pine Script Source File] ───┬───> [TradingView Engine (Golden Reference)] ───> TV_Output.json
                             │
                             └───> [PineOrca Broker Emulator] ───────────────> PineOrca_Output.json
                                                    │
                                                    ▼
                                     [Automated Deep-Diff Assertions]
                                     - Trade Fills: Price, Bar Index, Time, Size
                                     - Net Profit & Metrics: Divergence <= 0.001%
                                     - Excursions (MAE/MFE): Zero Cent Divergence
```

---

### 5.2 10 Canonical TradingView Golden Test Benchmark Strategies

The test suite validates PineOrca across 10 diverse reference strategies:

| # | Strategy Name | Core Mechanics Tested | TradingView Acceptance Tolerance |
| :--- | :--- | :--- | :--- |
| **1** | `Dual-MA-Crossover.pine` | Simple stop-and-reverse, single lot market orders at open | Exact fill price & PnL match ($0.00 divergence) |
| **2** | `RSI-Bracket-OCA.pine` | Limit entry, paired TP/SL exit brackets, OCO cancellation | Exact cancellation of companion leg on fill |
| **3** | `Pyramiding-MultiLot.pine` | Pyramiding = 5, FIFO lot queue partial exits | Correct FIFO lot closing sequence and trade PnL |
| **4** | `Trailing-Stop-Arming.pine`| Dynamic `trail_points` arming and `trail_offset` trailing | Exact trigger bar and trail peak matching |
| **5** | `Gap-Fill-Precedence.pine` | Gap open beyond stop/limit levels, open-phase fills | Fills at Open rather than literal limit/stop |
| **6** | `Polarity-Conflict.pine` | Both TP and SL within bar range, polarity path resolution | Execution of correct leg based on open proximity |
| **7** | `Bar-Magnifier-1m.pine` | Intrabar order matching across 1m LTF sub-bars | True crossing prices matching TV Bar Magnifier |
| **8** | `Margin-Call-Partial.pine` | High leverage, adverse move, 4x deficit partial liquidation | Partial liquidation events and closed trade quantities |
| **9** | `Short-Only-Excursions.pine`| Short entries, intrabar MAE and MFE excursion tracking | MAE/MFE dollar values matching TV Trade List |
| **10**| `Multi-Year-Analytics.pine` | 5-year daily backtest, CAGR, Sharpe, Sortino, Drawdown % | Metrics match within 0.01% numerical rounding |

---

### 5.3 Concrete Test Execution Commands

```bash
# 1. Run all unit and integration tests across the monorepo
npm test

# 2. Execute full TradingView golden parity suite
npx vitest run packages/pine-engine/test/parity-golden.test.ts

# 3. Run high-load 100,000-bar performance and memory benchmark
npx vitest run packages/pine-engine/test/benchmark-stress.test.ts
```

---

## 6. Technical Risks, Mitigations & Trade-Offs

### 6.1 Technical Risk Matrix

| Risk | Severity | Likelihood | Impact | Concrete Architectural Mitigation |
| :--- | :---: | :---: | :---: | :--- |
| **AGPL License Contamination** | High | Medium | Potential legal contamination of commercial host applications using Apache-2.0 Vela. | Strict separation across Worker boundary (`postMessage`). Main-thread UI imports only schema types and public interfaces. AGPL code isolated in worker bundle. |
| **Intrabar Ambiguity Divergence** | High | High | Synthetic polarity heuristic predicting different fill leg than TradingView on edge-case bars. | Implement exact proximity equation $\Delta_{\text{High}} \le \Delta_{\text{Low}}$ verified by TradingView documentation; recommend Bar Magnifier mode for high-stakes backtests. |
| **Garbage Collection Freezes** | Medium | Medium | Large datasets (100k+ bars) generating millions of temporary objects causing UI frame drops. | Use flat columnar typed buffers (`Float64Array`) and reusable cursor iterators in `Series.ts`. Transfer buffers to worker via zero-copy `postMessage(..., [transfers])`. |
| **Worker Synchronization Lag** | Medium | Low | Slow compilation or backtest execution causing UI to appear unresponsive. | Emit incremental progress heartbeats from worker; render skeleton shimmer states in Strategy Tester while run completes. |
| **Floating-Point Drift in Financials** | Low | Medium | Cumulative floating-point rounding errors causing penny discrepancies across thousands of trades. | Quantize all currency and price calculations to symbol `mintick` using integer tick arithmetic before storing in ledger. |

---

### 6.2 Architectural Trade-Offs

1. **Synthetic Polarity vs Bar Magnifier**:
   - *Trade-off*: Synthetic polarity runs in $O(N)$ with zero network overhead, but is an approximation. Bar Magnifier provides 100% truth, but requires downloading $60\times$ more data (1-minute bars).
   - *Decision*: Support both seamlessly. Default to polarity heuristic for fast instant backtests; provide single-click toggle to enable Bar Magnifier for institutional verification.
2. **Dedicated Web Worker vs Shared Worker**:
   - *Trade-off*: Dedicated workers provide isolated memory heaps per tab; shared workers allow cross-tab caching.
   - *Decision*: Use Dedicated Web Workers (`PineWorkerEngine`) to prevent multi-tab state contamination and simplify clean memory teardown on tab close.
3. **Monaco Editor Bundle Size**:
   - *Trade-off*: Full Monaco Editor adds ~4MB to bundle size.
   - *Decision*: Dynamically load Monaco via dynamic `import()` only when the user opens the Pine Editor tab, keeping initial chart load lightweight (<350KB).
