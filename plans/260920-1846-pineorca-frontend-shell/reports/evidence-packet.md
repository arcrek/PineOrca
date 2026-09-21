# PineOrca Frontend Implementation: Immutable Evidence Packet

## Request
Implement the frontend for PineOrca (`pineorca-frontend-shell`): A runnable, TradingView-grade financial charting and backtesting workspace that brings together the existing engine, worker bridge, chart adapter, and UI components into a complete, interactive web application.

## Codebase Context
- **Repository**: TypeScript 5.8 npm monorepo with `packages/*`.
- **Existing Packages**:
  - `@pineorca/data`: ColumnarBarTable (continuous Float64Array SOAs for OHLCV data), WebSocketProvider.
  - `@pineorca/engine-pinets`: Pine v5/v6 transpiler, StrategyKernel broker emulator (TV parity), IntrabarSimulator, FIFOLedger, LiveStreamingLoop, StateSnapshot, and worker script `packages/engine-pinets/src/worker/worker.ts` (`handleWorkerCommand`).
  - `@pineorca/worker-bridge`: Typed RPC client `WorkerBridge` managing Web Worker message multiplexing, Transferable ArrayBuffers, heartbeats.
  - `@pineorca/chart`: `VelaChartAdapter` wrapping `@luxalgo/vela` WebGL2 chart, dynamic pane routing (price overlay vs subpane oscillators), `TradeMarkerLayer` (canvas 2D trade markers), `TradeMarkerInteraction` (hover/click hit testing), `SceneTranslator` (PineRun -> Vela IndicatorModel).
  - `@pineorca/ui`: Pure TypeScript DOM components (no React/Vue dependency, TradingView dark-theme `#131722` styling):
    - `BottomDock`: 3-state dockable drawer (collapsed 36px pill, split 340px resizer, maximized 100%).
    - `StrategyTester`: Tabbed container with OverviewTab (KPI cards + Canvas Equity/Drawdown curves), PerformanceSummaryTab (3-column table), and ListOfTradesTab (virtualized grid with row recycling).
    - `MonacoPineEditor`: Monaco wrapper with Monarch Pine v5/v6 tokenizer, diagnostics squiggles, toolbar ("Save", "Add to Chart", "Update Strategy").
    - `CrossProbeController`: Bi-directional cross-probe between trade table and chart markers.
- **Test Baseline**: 15 test files, 95 tests passing (`npm test`).

## Key Missing Pieces to "Implement Frontend"
1. `TopBar` UI component: Header bar with symbol selector, timeframe picker, strategy presets, Run Backtest button, Live Stream toggle, execution status badge.
2. `PineOrcaWorkspace` (or `WorkspaceShell`): Top-level DOM orchestrator that mounts TopBar, VelaChartAdapter, BottomDock (hosting StrategyTester and MonacoPineEditor), wires CrossProbeController, and coordinates backtest execution / tick streaming.
3. Runnable Application Package (`packages/shell` or app entry): `index.html`, `vite.config.ts`, `src/main.ts`, Web Worker bundling (`new Worker(new URL(..., import.meta.url), { type: 'module' })`), preloaded golden fixtures for instant zero-config backtesting and browser demonstration (`npm run dev`).

## Confirmed Constraints
1. **Licensing Seam**: Host application (`@pineorca/shell`, `@pineorca/chart`, `@pineorca/ui`) is strictly **Apache-2.0**. `@pineorca/engine-pinets` runs inside an isolated Web Worker under **AGPL-3.0**. No compile-time copyleft leaks into host bundle.
2. **Zero-Copy / Responsiveness**: OHLCV data transfers via `ArrayBuffer` transfer lists; UI thread remains responsive (60 FPS); cross-probe hover latency $<16\text{ms}$.
3. **Framework Neutrality**: Pure TypeScript DOM components in `@pineorca/ui`.
4. **Monorepo Conventions**: npm workspaces, composite tsconfig project references, clean cutovers.

## Non-Goals
- Real-money live broker exchange execution or OMS.
- Cloud user authentication / remote database profiles.
- Rewriting `@pineorca/ui` into React/Vue/Svelte.

## Evaluation Rubric (1-20 Scale per criterion, Max 100)
1. **Architectural Coherence & Licensing Seam (20 pts)**: Strict separation of Apache-2.0 host and AGPL-3.0 worker; modularity between `@pineorca/ui` and `@pineorca/shell`.
2. **Completeness of Functional Scope (20 pts)**: TopBar, Workspace orchestrator, Chart + Markers, BottomDock + Tester + Editor, WorkerBridge execution, and Vite dev setup.
3. **Actionability & File Ownership (20 pts)**: Concrete file paths, exact symbols, step-by-step tasks, no vague hand-waving or cross-phase file collisions.
4. **Verification & Testing Rigor (20 pts)**: Headless unit/component test commands, DOM setup verification, interactive smoke tests, and build checks.
5. **Simplicity, Maintainability & Risk Mitigation (20 pts)**: Minimal weightless code, zero unneeded abstractions, clean handling of Vite worker bundling and Monaco editor assets.
