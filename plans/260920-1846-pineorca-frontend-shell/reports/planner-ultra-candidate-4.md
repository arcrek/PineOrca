# PineOrca Frontend Shell Implementation Plan (Candidate 4)

**Design Focus:** Comprehensive Testability (Headless Vitest DOM Mocks + Browser E2E Smoke Verification), Deterministic Layout Resizing, and Zero-Copy Minimal Boilerplate.  
**Target Output Artifact:** `plans/260920-1846-pineorca-frontend-shell/reports/planner-ultra-candidate-4.md`  
**Licensing Invariant:** Host UI/Shell/Chart strictly **Apache-2.0**; Engine worker sandboxed under **AGPL-3.0**.

---

## 1. Executive Summary & Architectural Vision

PineOrca currently possesses high-performance standalone engines and modular components:
1. `@pineorca/data`: Continuous 64-byte aligned columnar Float64 arrays (`ColumnarBarTable`).
2. `@pineorca/engine-pinets`: Pine v5/v6 transpiler, broker emulator (`FIFOLedger`), and worker execution kernel.
3. `@pineorca/worker-bridge`: Zero-copy typed RPC client (`WorkerBridge`).
4. `@pineorca/chart`: WebGL2 chart wrapper (`VelaChartAdapter`) with canvas 2D trade markers (`TradeMarkerLayer`, `TradeMarkerInteraction`).
5. `@pineorca/ui`: Pure TypeScript DOM components (`BottomDock`, `StrategyTester`, `MonacoPineEditor`, `CrossProbeController`).

The missing component is the **Frontend Shell**: an interactive, TradingView-grade web application bringing these subsystems into a cohesive, responsive workspace.

### Core Architectural Pillars
- **Zero-Copy Performance & Frame Stability:** Keep the UI thread locked at 60 FPS. Transfer market data over `postMessage` transfer lists using continuous ArrayBuffers. Process backtests asynchronously in the Web Worker.
- **Deterministic Layout Resizing:** Financial traders continuously resize the bottom docking panel between collapsed (36px status pill), split view (user-defined drag height), and maximized (100% overlay). Chart WebGL2 viewports, 2D overlay canvases, virtual data grids, and code editors must resize synchronously without layout thrashing, clipped canvases, or dropped animation frames.
- **Headless Testability & E2E Smoke Verification:** All DOM interactions, state machines, and layout mathematics must execute and pass in headless Vitest using zero-dependency DOM mocks (`setupTestDOM()`). End-to-end browser smoke verification guarantees instant Vite bundling and interactive chart mounting.
- **Minimal Boilerplate & Framework Neutrality:** 100% pure TypeScript DOM manipulation without React, Vue, or heavy UI frameworks. Clean separation of concerns with typed pub/sub event emitters.

---

## 2. Architecture & Data Flow Overview

```
+----------------------------------------------------------------------------------------------------+
|                                         PineOrca Shell (Browser Window)                           |
+----------------------------------------------------------------------------------------------------+
| TopBar (44px)                                                                                      |
| [Logo] [Symbol: BTCUSDT v] [TF: 1m|5m|15m|1h|1D] [Presets v] [▶ Run Backtest] [⚡ Live] [Status]  |
+----------------------------------------------------------------------------------------------------+
| Workspace Main Area (calc(100vh - 44px))                                                           |
| +------------------------------------------------------------------------------------------------+ |
| | Chart Container (calc(100% - dockHeight))                                                      | |
| |  - VelaChartAdapter (WebGL2 Candlestick / Subpanes)                                            | |
| |  - TradeMarkerLayer (Canvas2D Entry/Exit Arrows, Labels, PnL)                                  | |
| |  - TradeMarkerInteraction (Pointer hover/click hit testing)                                    | |
| +------------------------------------------------------------------------------------------------+ |
| | Resizer Bar (4px drag handle: ns-resize)                                                        | |
| +------------------------------------------------------------------------------------------------+ |
| | BottomDock Container (dockHeight: 36px | split 340px | maximized 100%)                          | |
| |  +-------------------------------------------------------------------------------------------+ | |
| |  | Dock Header: Tabs [Strategy Tester] [Pine Editor] | Summary Pills | [^] [_] [X]            | | |
| |  +-------------------------------------------------------------------------------------------+ | |
| |  | Tab Content:                                                                              | | |
| |  |  - StrategyTester: [Overview (KPI + Canvas Equity)] [Summary Table] [List of Trades (Grid)]| | |
| |  |  - MonacoPineEditor: Monarch Syntax Highlighting, Toolbar, Diagnostics Squiggles           | | |
| |  +-------------------------------------------------------------------------------------------+ | |
| +------------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
             |                                                                 ^
  Zero-Copy  | RUN_BACKTEST { bars, source, params }                           | BacktestResultPayload
  ArrayBuffer| Transferable List: [buffer]                                      | { metrics, trades, equity }
             v                                                                 |
+----------------------------------------------------------------------------------------------------+
| Web Worker Isolation Boundary (AGPL-3.0 Engine Sandbox)                                            |
|   packages/engine-pinets/src/worker/worker.ts (handleWorkerCommand)                                |
|   - ColumnarBarTable.fromPayload (O(1) memory view)                                                |
|   - PineTranspiler.transpile -> PineEngine synchronous execution                                  |
|   - FIFOLedger trade matching -> PerformanceMetrics computation                                    |
+----------------------------------------------------------------------------------------------------+
```

### Bi-Directional Cross-Probe Data Flow
1. **Chart to Table:** Hovering or clicking a trade marker in `TradeMarkerInteraction` (via `packages/chart/src/markers/TradeMarkerInteraction.ts:50`) triggers `CrossProbeController` (`packages/ui/src/controller/CrossProbeController.ts:66`). The controller instructs `ListOfTradesTab` (`packages/ui/src/tester/tabs/ListOfTradesTab.ts:320`) to select/highlight the corresponding row and smooth-scroll it into view.
2. **Table to Chart:** Clicking a trade row in the virtualized grid invokes `onRowClick`. `CrossProbeController` selects the marker in `TradeMarkerLayer`, triggers a pulse glow animation, and pans/centers the chart viewport on the trade timestamp.

---

## 3. Behavioral Checklist Verification

- [x] **Explicit data flows documented:** What enters, transforms, and exits each component is specified in Section 2 and Phase tasks.
- [x] **Dependency graph complete:** Strict phase sequencing: TopBar (Phase 1) -> Workspace & Resizing (Phase 2) -> Shell Package & Fixtures (Phase 3) -> Comprehensive Testing & E2E Smoke (Phase 4).
- [x] **Risk assessed per phase:** Likelihood $\times$ Impact evaluated with concrete mitigations for high-risk items.
- [x] **Backwards compatibility strategy stated:** Preserves existing `@pineorca/ui`, `@pineorca/chart`, and `@pineorca/worker-bridge` APIs; all changes are additive.
- [x] **Test matrix defined:** Headless unit tests (Vitest DOM mocks), integration flows, and browser E2E bundle smoke verification.
- [x] **Rollback plan exists:** File-level revert procedures without cascading regressions.
- [x] **File ownership assigned:** Distinct non-overlapping file sets per phase.
- [x] **Success criteria measurable:** Observable DOM assertions, layout bounds, and test outputs.

---

## 4. Licensing Seam & Process Boundary Architecture

To comply with the monorepo licensing constraints:
- **Host Layer (Apache-2.0):**
  - `@pineorca/data` (Columnar tables, buffer types)
  - `@pineorca/worker-bridge` (Typed RPC client)
  - `@pineorca/chart` (Vela adapter, marker rendering)
  - `@pineorca/ui` (`TopBar`, `BottomDock`, `StrategyTester`, `MonacoPineEditor`, `CrossProbeController`, `PineOrcaWorkspace`)
  - `@pineorca/shell` (Host application bundling)
- **Engine Layer (AGPL-3.0):**
  - `@pineorca/engine-pinets` (Transpiler, execution engine, broker simulation)
- **Isolation Enforcement:**
  - Neither `@pineorca/ui` nor `@pineorca/shell` host code imports from `@pineorca/engine-pinets` directly at compile time.
  - `@pineorca/shell` spawns the worker via:
    ```typescript
    const worker = new Worker(
      new URL('../../engine-pinets/src/worker/worker.ts', import.meta.url),
      { type: 'module' }
    );
    const bridge = new WorkerBridge({ worker });
    ```
  - Communication occurs exclusively through `postMessage` using serializable RPC commands defined in `@pineorca/worker-bridge/src/protocol.ts:1-140`.
  - Vite bundles the worker script into an isolated output chunk, preventing any AGPL copyleft leakage into the host application bundle.

---

## 5. Deterministic Layout Resizing Engine Architecture

A notorious defect in multi-pane charting applications is canvas deformation, dropped frames, or viewport desynchronization during dock resizing.

### Geometry Math & Layout State Machine
The layout coordinates are computed using deterministic bounds:

$$\text{Workspace Height} = H_{\text{viewport}} - H_{\text{topbar}} \quad (H_{\text{topbar}} = 44\text{px})$$

$$\text{Dock Height} (H_{\text{dock}}) = 
\begin{cases}
36\text{px} & \text{State} = \text{collapsed} \\
\text{clamp}(H_{\text{split}}, 120\text{px}, H_{\text{workspace}} - 100\text{px}) & \text{State} = \text{split} \\
H_{\text{workspace}} & \text{State} = \text{maximized}
\end{cases}$$

$$\text{Chart Height} (H_{\text{chart}}) = 
\begin{cases}
H_{\text{workspace}} - 36\text{px} & \text{State} = \text{collapsed} \\
H_{\text{workspace}} - H_{\text{dock}} & \text{State} = \text{split} \\
0\text{px} \text{ (display: none)} & \text{State} = \text{maximized}
\end{cases}$$

### Synchronous Propagation & rAF Coalescing
1. **Drag Resizing:** Mouse dragging on `pineorca-dock-resizer` updates $H_{\text{split}}$ in real-time.
2. **Synchronous Style Updates:** The dock height and chart container flex-basis/height styles are updated immediately to eliminate visual rubber-banding.
3. **Coalesced Canvas Repaint:** Marker canvas rendering and Vela resize triggers are coalesced via `requestAnimationFrame` to prevent ResizeObserver loop limit exceedance:
   ```typescript
   private scheduleLayoutUpdate(): void {
     if (this.rafId !== null) return;
     this.rafId = requestAnimationFrame(() => {
       this.rafId = null;
       this.applyLayoutGeometry();
     });
   }
   ```
4. **Child Subsystem Notifications:**
   - `VelaChartAdapter.requestMarkerRepaint()` adjusts canvas dimensions:
     $$\text{canvas.width} = \text{Math.round}(W \times \text{dpr}), \quad \text{canvas.height} = \text{Math.round}(H \times \text{dpr})$$
   - `ListOfTradesTab.handleResize()` recomputes virtual grid scroll height and visible window.
   - `MonacoPineEditor.layout()` recalculates code editor viewport lines.

---

## 6. Comprehensive Testability & Verification Strategy

The architecture is built for rigorous dual-layer testability:

### Layer 1: Headless Vitest DOM Tests (CI Fast-Path)
- Uses `packages/ui/test/setup-dom.ts` (`MockHTMLElement`, `MockHTMLCanvasElement`, `MockResizeObserver`, `setupTestDOM()`).
- No JSDOM or heavy browser dependencies required; runs in milliseconds in pure Node.js environments.
- Tests cover:
  1. Full DOM mounting, element hierarchy, and attribute correctness.
  2. Click, select, and keyboard event dispatching.
  3. Dock state transitions: `split` (340px) $\leftrightarrow$ `collapsed` (36px) $\leftrightarrow$ `maximized` (100%).
  4. Resizer mouse-drag math, clamping boundaries, and event unbinding.
  5. Mock `WorkerLike` RPC message round-trip, progress reporting, and error handling.
  6. Bi-directional cross-probe event triggering between virtual grid and marker layer.

### Layer 2: Browser E2E Smoke Verification (Production Build Safety)
- Vite production build verification (`packages/shell` bundle creation).
- Headless script verifying `index.html` structure, CSS dark theme variables (`#131722`), Web Worker module configuration, and fixture dataset loading.

---

## 7. Phased Implementation Plan

```
+-----------------------------------------------------------------------------------+
| Phase 1: TopBar Component & Headless UI Unit Tests                                |
| - Implement TopBar.ts with TV styling, badges, inputs, and events                 |
| - Verify with packages/ui/test/topbar.test.ts (Headless DOM mocks)                |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Phase 2: PineOrcaWorkspace Orchestrator & Deterministic Layout Engine             |
| - Implement PineOrcaWorkspace.ts with multi-pane wiring & resizing math           |
| - Wire CrossProbeController, WorkerBridge, VelaChartAdapter, and BottomDock       |
| - Verify with packages/ui/test/workspace.test.ts & layout-resizing.test.ts        |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Phase 3: Runnable Application Shell Package (@pineorca/shell)                     |
| - Scaffold packages/shell (vite.config.ts, index.html, main.ts, worker.ts)        |
| - Wire Golden Fixtures presets (RSI, MACD, Turtle, Bollinger, Margin Call)        |
| - Verify Vite development server and production build output                      |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Phase 4: Integration Test Suite & Browser Smoke Verification                      |
| - End-to-end headless integration test (workspace + mock worker execution)        |
| - Browser E2E smoke verification test (bundle artifacts, zero console errors)     |
+-----------------------------------------------------------------------------------+
```

---

### Phase 1: TopBar Component & Headless UI Unit Tests

#### Goal
Create a standalone, framework-agnostic `TopBar` UI component in `@pineorca/ui` that provides header controls for symbol selection, timeframe switching, preset selection, backtest triggering, live streaming toggle, and real-time execution status display.

#### Detailed Tasks
1. **Create `packages/ui/src/topbar/TopBar.ts`:**
   - Define interfaces:
     ```typescript
     export type ExecutionStatus = 'idle' | 'running' | 'streaming' | 'complete' | 'error';

     export interface TopBarOptions {
       initialSymbol?: string;
       symbols?: string[];
       initialTimeframe?: string;
       timeframes?: string[];
       presets?: Array<{ id: string; name: string }>;
       initialPresetId?: string;
     }

     export interface TopBarEvents {
       onSymbolChange: (symbol: string) => void;
       onTimeframeChange: (timeframe: string) => void;
       onPresetChange: (presetId: string) => void;
       onRunBacktest: () => void;
       onStreamToggle: (active: boolean) => void;
     }
     ```
   - Implement `TopBar` class:
     - `mount(container: HTMLElement): void`
     - `destroy(): void`
     - `setStatus(status: ExecutionStatus, message?: string, progress?: number): void`
     - `setSymbol(symbol: string): void`
     - `setTimeframe(tf: string): void`
     - `setStreaming(active: boolean): void`
     - `setPresets(presets: Array<{ id: string; name: string }>, activeId?: string): void`
     - Event registration methods: `onSymbolChange(cb)`, `onTimeframeChange(cb)`, `onPresetChange(cb)`, `onRunBacktest(cb)`, `onStreamToggle(cb)`.
   - Styling:
     - Height: 44px, background: `#131722`, border bottom: `1px solid #2a2e39`, font family: system-ui.
     - Brand logo: "PineOrca" in bold `#d1d4dc` with cyan `#00e5ff` dot or badge.
     - Buttons: TradingView dark palette. Primary "Run Backtest" in `#2962ff` (hover `#1e53e5`), disabled state with CSS spinner.
     - Timeframe segmented control: Active button styled with `#2962ff` background and white text.
     - Status badge: Color-coded pills (`idle`: `#787b86`, `running`: `#2962ff`, `streaming`: `#22ab94`, `complete`: `#22ab94`, `error`: `#f23645`).
2. **Export `TopBar` from `@pineorca/ui`:**
   - Update `packages/ui/src/index.ts` to export `TopBar` and related types.
   - Update `packages/ui/package.json` to expose `"./topbar": { "import": "./src/topbar/TopBar.ts", "types": "./src/topbar/TopBar.ts" }`.
3. **Implement Unit Tests in `packages/ui/test/topbar.test.ts`:**
   - Use `setupTestDOM()` from `packages/ui/test/setup-dom.ts`.
   - Verify initial DOM structure, select element options, and timeframe pills.
   - Verify status transitions and badge updates (`idle` $\to$ `running` with progress $\to$ `complete` $\to$ `error`).
   - Verify event emissions on symbol change, timeframe button click, preset selection, run click, and live stream toggle.
   - Verify cleanup and listener detachment in `destroy()`.

#### Verification Command
```bash
npx vitest run packages/ui/test/topbar.test.ts
```

---

### Phase 2: PineOrcaWorkspace Orchestrator & Deterministic Layout Engine

#### Goal
Implement `PineOrcaWorkspace` in `@pineorca/ui` as the central orchestrator that unifies `TopBar`, `VelaChartAdapter`, `BottomDock` (housing `StrategyTester` and `MonacoPineEditor`), `CrossProbeController`, and `WorkerBridge` with deterministic layout resizing.

#### Detailed Tasks
1. **Create `packages/ui/src/workspace/types.ts`:**
   ```typescript
   import type { ColumnarBarTable } from '@pineorca/data';
   import type { WorkerBridge } from '@pineorca/worker-bridge';
   import type { BacktestParams } from '@pineorca/worker-bridge';

   export interface PresetStrategy {
     id: string;
     name: string;
     description?: string;
     symbol: string;
     timeframe: string;
     source: string;
     bars: ColumnarBarTable;
     params?: BacktestParams;
   }

   export interface WorkspaceOptions {
     bridge: WorkerBridge;
     presets?: PresetStrategy[];
     initialPresetId?: string;
     initialDockHeight?: number;
     initialDockState?: 'collapsed' | 'split' | 'maximized';
   }
   ```
2. **Create `packages/ui/src/workspace/PineOrcaWorkspace.ts`:**
   - **DOM Construction:**
     - Root container: `.pineorca-workspace` (`display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; background: #131722; position: relative;`).
     - Header container: Hosts `TopBar` (fixed height: 44px).
     - Main area container: `.pineorca-workspace-main` (`flex: 1 1 0; display: flex; flex-direction: column; min-height: 0; position: relative; overflow: hidden;`).
     - Chart host: `.pineorca-chart-host` (`flex: 1 1 0; min-height: 0; position: relative; overflow: hidden;`).
     - Dock host: Hosts `BottomDock`.
   - **Subsystem Instantiation & Mounting:**
     - `TopBar`: mounted into header container.
     - `VelaChartAdapter`: mounted into chart host.
     - `StrategyTester`: mounted into tab `'tester'` of `BottomDock`.
     - `MonacoPineEditor`: mounted into tab `'editor'` of `BottomDock`.
     - `CrossProbeController`: instantiated and attached between `VelaChartAdapter` and `StrategyTester.getListOfTradesTab()`.
   - **Deterministic Layout Engine:**
     - Listen to `dock.onHeightChange(height)` and `dock.onStateChange(state)`.
     - In `split` mode: set dock height; chart occupies remaining space (`flex: 1 1 0`).
     - In `collapsed` mode: dock height = 36px; chart expands to fill remaining space.
     - In `maximized` mode: dock style `position: absolute; inset: 0; z-index: 20; height: 100%`; chart hidden.
     - Attach `ResizeObserver` to root container; coalesce resize events with `requestAnimationFrame`.
     - On geometry update: invoke `chartAdapter.requestMarkerRepaint()` and `strategyTester.getListOfTradesTab().handleResize()`.
   - **Execution Coordination (`runBacktest`):**
     - Collect source code from `MonacoPineEditor.getValue()`.
     - Retrieve active `ColumnarBarTable` for selected symbol/timeframe.
     - Call `TopBar.setStatus('running', 'Transpiling & executing...', 0)`.
     - Invoke `bridge.runBacktest(...)` with progress listener updating TopBar badge.
     - On result:
       - Format metrics and equity curve $\to$ `strategyTester.setResults(...)`.
       - Format closed trades into `TradeExecution[]` $\to$ `chartAdapter.setTrades(executions)`.
       - Update summary pills in `BottomDock.updateSummary(...)`.
       - Call `TopBar.setStatus('complete', `Done in ${duration}ms (${tradeCount} trades)`)`.
     - On error:
       - Update `TopBar.setStatus('error', error.message)`.
       - Set squiggles in `editor.setDiagnostics([error])`.
   - **Preset Management:**
     - `loadPreset(presetId: string)`: Updates editor code, updates TopBar symbol and timeframe, populates chart with candlestick data, and triggers backtest.
   - **Streaming Loop:**
     - Start/stop simulated or real-time tick streaming via `bridge.streamTick(...)`.
3. **Export Workspace from `@pineorca/ui`:**
   - Update `packages/ui/src/index.ts` and `packages/ui/package.json` exports.
4. **Implement Tests in `packages/ui/test/workspace.test.ts` & `layout-resizing.test.ts`:**
   - Verify mounting of all children (`TopBar`, `ChartHost`, `BottomDock`, `StrategyTester`, `MonacoEditor`).
   - Verify layout math across `split`, `collapsed`, and `maximized` transitions.
   - Verify simulated drag resizing clamp limits (e.g. height cannot drop below 120px or exceed container bounds).
   - Verify mock backtest execution pipeline and UI update propagation.
   - Verify cross-probe wiring between trade click and chart marker selection.

#### Verification Command
```bash
npx vitest run packages/ui/test/workspace.test.ts packages/ui/test/layout-resizing.test.ts
```

---

### Phase 3: Runnable Application Shell Package (`@pineorca/shell`)

#### Goal
Create the `@pineorca/shell` runnable application package powered by Vite, bundling the Web Worker in an isolated chunk, preloading golden strategy presets, and booting a full-screen interactive financial chart application.

#### Detailed Tasks
1. **Create `packages/shell/package.json`:**
   ```json
   {
     "name": "@pineorca/shell",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "vite",
       "build": "tsc && vite build",
       "preview": "vite preview",
       "test": "vitest run"
     },
     "dependencies": {
       "@pineorca/data": "*",
       "@pineorca/worker-bridge": "*",
       "@pineorca/chart": "*",
       "@pineorca/ui": "*"
     },
     "devDependencies": {
       "@pineorca/engine-pinets": "*",
       "typescript": "^5.8.0",
       "vite": "^6.0.0"
     }
   }
   ```
   *Note: `@pineorca/engine-pinets` is only a devDependency used for building the Web Worker entry chunk.*
2. **Create `packages/shell/tsconfig.json`:**
   - Extend `../../tsconfig.json`, target `ES2022`, module `NodeNext`, include `["src/**/*"]`.
3. **Create `packages/shell/vite.config.ts`:**
   ```typescript
   import { defineConfig } from 'vite';

   export default defineConfig({
     server: {
       port: 5173,
       strictPort: false,
     },
     worker: {
       format: 'es',
     },
     build: {
       target: 'esnext',
       sourcemap: true,
     },
   });
   ```
4. **Create `packages/shell/index.html`:**
   - HTML shell with viewport meta tags, dark background (`#131722`), full-viewport reset CSS, and `<div id="app"></div>`.
   - Load entry `<script type="module" src="/src/main.ts"></script>`.
5. **Create `packages/shell/src/worker.ts`:**
   - Dedicated Web Worker entry point importing and delegating to `@pineorca/engine-pinets/src/worker/worker.ts`:
     ```typescript
     import { handleWorkerCommand } from '@pineorca/engine-pinets/worker';

     const scope: any = typeof self !== 'undefined' ? self : globalThis;
     if (typeof scope.postMessage === 'function' && typeof scope.addEventListener === 'function') {
       scope.addEventListener('message', (event: MessageEvent) => {
         if (event.data && event.data.type) {
           handleWorkerCommand(event.data, (res) => scope.postMessage(res));
         }
       });
     }
     ```
6. **Create `packages/shell/src/fixtures/presets.ts`:**
   - Convert golden fixture JSON files from `tests/golden/fixtures/`:
     - `rsi-mean-reversion.tv.json`
     - `macd-reversal.tv.json`
     - `turtle-trailing.tv.json`
     - `bb-pyramiding.tv.json`
     - `crypto-margin-call.tv.json`
   - Transform `bars` arrays into `ColumnarBarTable` instances using `ColumnarBarTable.fromBars(fixture.bars)`.
   - Export standard `PresetStrategy[]` array for zero-config offline demonstration.
7. **Create `packages/shell/src/main.ts`:**
   - Application entry point:
     1. Instantiate Web Worker: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
     2. Initialize `WorkerBridge`.
     3. Instantiate `PineOrcaWorkspace` with presets and bridge.
     4. Mount to `#app`.
     5. Automatically load the initial preset ("RSI Mean Reversion") and run backtest to provide instant out-of-the-box visualization.
8. **Update Monorepo Integration:**
   - Add `{ "path": "./packages/shell" }` to `tsconfig.json` root project references.
   - Add `"dev": "npm run --workspace=@pineorca/shell dev"` and `"build:shell": "npm run --workspace=@pineorca/shell build"` to root `package.json`.

#### Verification Command
```bash
npm run build --workspace=@pineorca/shell
```

---

### Phase 4: Comprehensive Test Matrix & Browser E2E Smoke Verification

#### Goal
Validate the entire stack across headless integration flows and browser bundle verification, ensuring 100% determinism, zero memory leaks, and rock-solid error recovery.

#### Detailed Tasks
1. **Create `packages/ui/test/integration.test.ts`:**
   - Complete headless integration test:
     - Mounts `PineOrcaWorkspace` in `setupTestDOM()`.
     - Feeds sample `ColumnarBarTable` and Pine script.
     - Simulates worker RPC roundtrip returning `BacktestResultPayload`.
     - Asserts:
       - Chart receives `TradeExecution[]` and draws markers.
       - Dock header receives summary metrics and renders pills (`Net Profit`, `Win Rate`, `Profit Factor`).
       - StrategyTester overview shows KPI cards and equity canvas.
       - Virtualized trade grid receives rows and selects row on marker click.
       - Editor displays error squiggles if syntax error is returned.
2. **Create `packages/shell/test/e2e-smoke.test.ts`:**
   - Verify bundle creation: ensures `vite build` produces `dist/index.html` and JavaScript chunks without syntax or type errors.
   - Headless DOM smoke test: imports and mounts `main.ts` in mock environment, verifying that `#app` contains `.pineorca-workspace`, `.pineorca-topbar`, `.pineorca-chart-host`, and `.pineorca-bottom-dock`.
3. **Validate Layout Stability Benchmarks:**
   - Stress-test 1,000 continuous resize events in `layout-resizing.test.ts` to confirm memory does not leak and bounds remain clamped.

#### Verification Command
```bash
npx vitest run packages/ui/test/integration.test.ts packages/shell/test/e2e-smoke.test.ts
```

---

## 8. Detailed File-by-File Specification & Symbol Catalog

| File Path | Primary Exported Symbols | Line Citations / External Dependencies | Role & Responsibility |
|---|---|---|---|
| `packages/ui/src/topbar/TopBar.ts` | `TopBar`, `ExecutionStatus`, `TopBarOptions` | CSS tokens from TV dark palette `#131722` | Header control bar with symbol/timeframe selection, backtest trigger, and status badge |
| `packages/ui/src/workspace/types.ts` | `PresetStrategy`, `WorkspaceOptions`, `WorkspaceState` | `@pineorca/data:ColumnarBarTable`, `@pineorca/worker-bridge:WorkerBridge` | Type definitions for workspace configuration and state management |
| `packages/ui/src/workspace/PineOrcaWorkspace.ts` | `PineOrcaWorkspace` | `packages/ui/src/dock/BottomDock.ts:33`, `packages/ui/src/tester/StrategyTester.ts:22`, `packages/ui/src/controller/CrossProbeController.ts:47`, `packages/chart/src/VelaChartAdapter.ts:24` | Top-level DOM orchestrator, layout manager, and execution coordinator |
| `packages/ui/src/index.ts` | Re-exports `TopBar`, `PineOrcaWorkspace` | Additive exports | Public entry for `@pineorca/ui` package |
| `packages/ui/test/topbar.test.ts` | Test suite | `packages/ui/test/setup-dom.ts:178` (`setupTestDOM`) | Headless Vitest tests for TopBar component |
| `packages/ui/test/workspace.test.ts` | Test suite | `packages/ui/test/setup-dom.ts:178`, Mock `WorkerLike` | Headless Vitest tests for workspace initialization and execution flows |
| `packages/ui/test/layout-resizing.test.ts` | Test suite | `packages/ui/src/dock/BottomDock.ts:34-37` | Strict mathematical verification of layout resizing and clamping bounds |
| `packages/ui/test/integration.test.ts` | Test suite | Full `@pineorca/ui` and mock engine | End-to-end integration test of the complete UI pipeline |
| `packages/shell/package.json` | npm package config | Vite, TypeScript, workspace dependencies | Standalone application manifest |
| `packages/shell/vite.config.ts` | Vite configuration | ES module worker bundling | Vite build configuration |
| `packages/shell/index.html` | HTML document | Mounts `<div id="app">` | Web application root document |
| `packages/shell/src/worker.ts` | Worker script | `@pineorca/engine-pinets/src/worker/worker.ts:135` | Web Worker sandbox entry point isolating AGPL engine |
| `packages/shell/src/fixtures/presets.ts` | `GOLDEN_PRESETS`, `loadPresetData` | `tests/golden/fixtures/*.tv.json`, `packages/data/src/columnar/ColumnarBarTable.ts:65` | Bundled strategy fixtures for instant offline backtesting |
| `packages/shell/src/main.ts` | Application bootstrap | Spawns `Worker`, boots `PineOrcaWorkspace` | Web application runtime entry point |
| `packages/shell/test/e2e-smoke.test.ts` | Test suite | Vitest, Node fs/child_process | Smoke test verifying bundle generation and shell mounting |

---

## 9. Edge Case & Failure Mode Matrix

| Scenario / Edge Case | Likelihood | Impact | Root Cause | Architectural Mitigation |
|---|---|---|---|---|
| **ResizeObserver Loop Limit Exceeded** | High | Low (Console error) | Synchronous DOM mutations inside ResizeObserver callback | Coalesce layout recalculations using `requestAnimationFrame`; ignore zero-dimension rects. |
| **Worker Crash or Infinite Pine Loop** | Medium | High | Malformed user Pine script (`while true`) | `WorkerBridge` 30s timeout (`packages/worker-bridge/src/WorkerBridge.ts:40`); provide "Cancel Run" button to terminate and respawn worker. |
| **Marker Repaint on Zero-Dimension Container** | Medium | Medium | Canvas scale error `drawImage/scale(0, 0)` when collapsed | Check `rect.width > 0 && rect.height > 0` before calling `ctx.scale(dpr, dpr)` in `VelaChartAdapter.handleResize` (`packages/chart/src/VelaChartAdapter.ts:145`). |
| **Rapid Dock Resizer Drag Overflows Viewport** | Medium | Medium | Mouse drag coordinates moving faster than DOM update | Clamp dock height strictly between `minHeight = 120px` and `maxHeight = workspaceHeight - 100px`. |
| **Transferred ArrayBuffer Detachment** | High | High | Reusing `ColumnarBarTable` buffer after it has been transferred via `postMessage` | In `PineOrcaWorkspace.runBacktest()`, call `table.clone()` before sending, or pass `table.toPayload()` with fresh continuous buffers so local chart data remains intact. |
| **Monaco Editor Absent in Headless CI** | High | Low | Monaco runtime missing in Node/Vitest test environment | `MonacoPineEditor` automatically falls back to an accessible `<textarea>` when `monaco` is not found (`packages/ui/src/editor/MonacoPineEditor.ts:269`), allowing tests to pass seamlessly. |
| **Large Trade Count DOM Bloat (>10k trades)** | Medium | High | Rendering thousands of unvirtualized DOM nodes | `ListOfTradesTab` uses `VirtualDataGrid` with constant-size DOM element pool recycling (`packages/ui/src/tester/tabs/ListOfTradesTab.ts:38`). |

---

## 10. Rollback & Migration Strategy

1. **Isolation of New Code:** All new components are placed into either new directories (`packages/ui/src/topbar/`, `packages/ui/src/workspace/`) or a dedicated package (`packages/shell/`). No existing core algorithms in `@pineorca/engine-pinets`, `@pineorca/data`, or `@pineorca/worker-bridge` are modified destructively.
2. **Step-by-Step Rollback:**
   - If Phase 4 fails: Revert `packages/shell/test/e2e-smoke.test.ts` and `packages/ui/test/integration.test.ts`.
   - If Phase 3 fails: Delete `packages/shell/` and remove its reference from root `package.json` and `tsconfig.json`. Existing packages remain 100% operational.
   - If Phase 2 fails: Remove `packages/ui/src/workspace/` and its exports from `packages/ui/src/index.ts`.
   - If Phase 1 fails: Remove `packages/ui/src/topbar/` and its test file.
3. **Safe Git Revert Boundary:** Each phase represents an isolated git commit that can be reverted independently without affecting sibling packages.

---

## 11. Final Acceptance Checklist

- [ ] `TopBar` renders brand, symbol selector, timeframe picker, preset dropdown, run button, live toggle, and status badge.
- [ ] `PineOrcaWorkspace` successfully mounts `TopBar`, `VelaChartAdapter`, and `BottomDock` (with `StrategyTester` and `MonacoPineEditor`).
- [ ] Layout resizing math works deterministically across `collapsed` (36px), `split` (clamped), and `maximized` (100%) states.
- [ ] Bi-directional cross-probe synchronizes hover and selection between chart trade markers and virtualized trade table rows in $<16\text{ms}$.
- [ ] `@pineorca/shell` boots via `npm run dev` in Vite and bundles cleanly via `npm run build`.
- [ ] Web Worker executes Pine scripts in a separate thread without AGPL leakage into the Apache-2.0 host bundle.
- [ ] Golden fixtures run out-of-the-box and render candlesticks, indicators, equity curve, KPI metrics, and trades.
- [ ] Headless Vitest test suite (`packages/ui/test/*.test.ts`) passes with 100% success in pure Node.js.
