---
phase: 4
title: "Runnable Application Package (@pineorca/shell) & Vite Dev Workspace"
status: complete
priority: P1
effort: "1d"
dependencies: [1, 2, 3]
---

# Phase 4: Runnable Application Package (@pineorca/shell) & Vite Dev Workspace

#### 1. Objectives
- Scaffold the runnable application package `packages/shell` with Vite, TypeScript project references, HTML entry, and clean CSS styling.
- Create the isolated Web Worker script (`packages/shell/src/worker/engine.worker.ts`) importing the AGPL engine inside the worker boundary.
- Implement `AppController`: the operational heart connecting TopBar, Chart, WorkerBridge, MonacoPineEditor, StrategyTester, Fixtures, and the 60Hz live streaming loop.
- Deliver automated licensing boundary verification ensuring zero AGPL AST leaks into the host bundle.
- Configure root `npm run dev` to launch the interactive workspace on `http://localhost:5173`.

#### 2. File Ownership & Exact Symbols
- **`packages/shell/package.json`**:
  - Name: `@pineorca/shell`, License: `Apache-2.0`.
  - Dependencies: `@pineorca/data`, `@pineorca/chart`, `@pineorca/ui`, `@pineorca/worker-bridge`, `@luxalgo/vela`.
  - DevDependencies: `vite`, `typescript`, `@types/node`, `vitest`.
- **`packages/shell/tsconfig.json`**: Composite project configuration.
- **`packages/shell/vite.config.ts`**: Vite configuration with `worker: { format: 'es' }`.
- **`packages/shell/index.html`**: Host HTML page with `#app` root and viewport meta tags.
- **`packages/shell/src/worker/engine.worker.ts`**:
  - Web Worker entry point under AGPL-3.0.
  - Symbol: `handleWorkerCommand` invocation over `self.onmessage`.
- **`packages/shell/src/fixtures/golden-bars.ts`**:
  - Function: `getGoldenBarTable(count?: number): ColumnarBarTable`.
- **`packages/shell/src/presets/index.ts`**:
  - Constant: `STRATEGY_PRESETS: Record<string, { name: string; code: string }>`.
- **`packages/shell/src/controller/AppController.ts`**:
  - Class: `AppController`.
  - Methods: `init(): Promise<void>`, `runBacktest(): Promise<void>`, `startLiveStreaming(): void`, `stopLiveStreaming(): void`, `destroy(): void`.
- **`packages/shell/src/main.ts`**: Application bootloader.
- **`packages/shell/test/licensing-boundary.test.ts`**: Automated bundle and AST scan for licensing compliance.
- **`packages/shell/test/app-controller.test.ts`**: Headless end-to-end integration test.
- **`package.json` (root)**: Add script `"dev": "npm --workspace=@pineorca/shell run dev"`.

#### 3. Step-by-Step Implementation Tasks
1. Create `packages/shell/package.json` and `packages/shell/tsconfig.json`.
2. Create `packages/shell/vite.config.ts`:
   - Setup server port `5173`.
   - Setup worker config: `worker: { format: 'es' }`.
   - Setup path aliases/resolutions matching monorepo workspace packages.
3. Create `packages/shell/index.html`:
   - Root element `<div id="app"></div>`.
   - Reset margins, set dark background `#131722`, and load system font stack.
4. Create `packages/shell/src/worker/engine.worker.ts`:
   ```ts
   // SPDX-License-Identifier: AGPL-3.0-only
   import { handleWorkerCommand } from '@pineorca/engine-pinets/worker';

   self.onmessage = async (e: MessageEvent) => {
     await handleWorkerCommand(e.data, (res, transfer) => {
       if (transfer && transfer.length > 0) {
         (self as any).postMessage(res, transfer);
       } else {
         self.postMessage(res);
       }
     });
   };
   ```
5. Create `packages/shell/src/fixtures/golden-bars.ts`:
   - Implement deterministic seeded generator producing 5,000 hourly BTC/USDT bars.
   - Return structured `ColumnarBarTable`.
6. Create `packages/shell/src/presets/index.ts`:
   - Define presets: RSI Mean Reversion, Dual EMA Trend Follow, Bollinger Bands Breakout.
7. Create `packages/shell/src/controller/AppController.ts`:
   - Instantiate `WorkerBridge` with `new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' })`.
   - Instantiate `PineOrcaWorkspace` and mount into target container.
   - Instantiate `VelaChartAdapter` and mount into `workspace.getChartContainer()`.
   - Connect TopBar actions:
     - `onRunBacktest` -> executes `runBacktest()`.
     - `onToggleStreaming` -> starts/stops live streaming loop.
     - `onPresetChange` -> updates code in `MonacoPineEditor`.
   - Connect Editor actions:
     - `onAction('updateStrategy')` / `onAction('addToChart')` -> triggers `runBacktest()`.
   - In `runBacktest()`:
     - Update TopBar status to `'running'`.
     - Retrieve code from editor and bars from golden fixture.
     - Execute `WorkerBridge.runBacktest(...)` with zero-copy ArrayBuffer transfer.
     - On result:
       - Update chart scene via `SceneTranslator.translate`.
       - Populate `StrategyTester` (OverviewTab metrics, equity curves, ListOfTradesTab rows).
       - Update BottomDock summary pills (Net profit, Win rate, Profit factor).
       - Update TopBar status to `'idle'` with elapsed duration chip.
   - In `startLiveStreaming()`:
     - Initialize tick generator and 60Hz micro-batch loop.
     - Feed ticks to `WorkerBridge.streamTick` and apply returned bar updates directly to `VelaChartAdapter.updateCandle`.
8. Create `packages/shell/src/main.ts` creating and booting `AppController`.
9. Create `packages/shell/test/licensing-boundary.test.ts`:
   - Parse package manifests and source ASTs in `@pineorca/shell`, `@pineorca/ui`, `@pineorca/chart`.
   - Assert that 0 files import `@pineorca/engine-pinets` outside of `packages/shell/src/worker/engine.worker.ts`.
10. Create `packages/shell/test/app-controller.test.ts`:
    - Headless end-to-end integration test validating boot, fixture loading, backtest dispatch, and UI component update.
11. Update root `package.json` to include `"dev": "npm --workspace=@pineorca/shell run dev"`.

#### 4. Verification Commands
```bash
# Run licensing isolation automated audit
npx vitest run packages/shell/test/licensing-boundary.test.ts

# Run headless AppController integration test
npx vitest run packages/shell/test/app-controller.test.ts

# Run monorepo typecheck to ensure zero project reference or typing errors
npm run typecheck

# Verify dev build succeeds
npm --workspace=@pineorca/shell run build
```

---

## 7. Risk Assessment & Mitigations

| Risk / Failure Mode | Likelihood | Impact | Severity | Mitigation Strategy |
|---|---|---|---|---|
| **Copyleft License Contamination** | Low | High | High | Automated licensing audit test (`licensing-boundary.test.ts`) checks all package manifests and imports. Worker script is strictly isolated in its own chunk. |
| **High-Frequency Tick Flooding (Frame Drops)** | Medium | High | High | Host-side `LiveStreamingCoordinator` uses 60Hz ($16.6\text{ms}$) `requestAnimationFrame` micro-batching. Engine uses provisional `StateSnapshot` rollbacks to prevent state drift. |
| **CrossProbe Feedback Ping-Pong** | Medium | Medium | Medium | `CrossProbeController` enforces an atomic `isSyncing` re-entrancy lock during table $\leftrightarrow$ chart event dispatch. |
| **Monaco Editor Assets Crashing Vite/Headless** | Medium | Medium | Medium | `MonacoPineEditor` provides a built-in dark fallback textarea that activates when Monaco runtime is absent, guaranteeing 100% headless test stability. |
| **ArrayBuffer Detachment Invalidation** | Low | High | Medium | `WorkerBridge` checks `table.isDetached` before transfer; creates a clone if the caller requested non-destructive execution. |
| **BottomDock Resizing Clipping WebGL Canvas** | Low | Medium | Low | `PineOrcaWorkspace` attaches a `ResizeObserver` on the dock and invokes `VelaChartAdapter.resize()` on every dimension change. |

---

## 8. Backwards Compatibility & System Invariants

1. **Monorepo Baseline Invariant**: All 15 existing test suites and 95 passing tests across `@pineorca/data`, `@pineorca/engine-pinets`, `@pineorca/worker-bridge`, `@pineorca/chart`, and `@pineorca/ui` must pass without regressions.
2. **Framework Neutrality**: `@pineorca/ui` remains 100% pure TypeScript DOM without React, Vue, or Svelte dependencies.
3. **Zero-Copy Performance SLA**: Transferring 50,000 historical bars across the Web Worker boundary takes $<1\text{ms}$ via `ArrayBuffer` transfer lists.
4. **Cross-Probe Responsiveness SLA**: Hovering between trade table rows and chart markers reacts in $<16\text{ms}$ ($<10\text{ms}$ benchmarked).
5. **Clean Cutover**: Deprecated or dangling imports are removed cleanly without leaving stubbed or dead code.

---

## 9. Comprehensive Acceptance & Verification Matrix

| Component | Target File | Verification Metric / Command | Success Criteria |
|---|---|---|---|
| **Licensing Boundary** | `packages/shell/test/licensing-boundary.test.ts` | `npx vitest run packages/shell/test/licensing-boundary.test.ts` | 0 imports of `engine-pinets` in host packages; 100% clean Apache-2.0 seam. |
| **Streaming Protocol** | `packages/worker-bridge/test/streaming-protocol.test.ts` | `npx vitest run packages/worker-bridge/test/streaming-protocol.test.ts` | `STREAM_TICK` commands dispatch and resolve with 0 state drift. |
| **TopBar Component** | `packages/ui/test/topbar.test.ts` | `npx vitest run packages/ui/test/topbar.test.ts` | All controls, badges, buttons, and event listeners function properly in mock DOM. |
| **Workspace Layout** | `packages/ui/test/workspace.test.ts` | `npx vitest run packages/ui/test/workspace.test.ts` | TopBar, Chart Host, and BottomDock mount cleanly with zero memory leaks. |
| **CrossProbe Sync** | `packages/chart/test/crossprobe-sync.test.ts` | `npx vitest run packages/chart/test/crossprobe-sync.test.ts` | Table click centers chart; chart click scrolls virtual grid; latency $<16\text{ms}$. |
| **AppController E2E** | `packages/shell/test/app-controller.test.ts` | `npx vitest run packages/shell/test/app-controller.test.ts` | Complete backtest flow loads fixture, transpiles, and renders results. |
| **Shell Build** | `packages/shell` | `npm --workspace=@pineorca/shell run build` | Vite successfully produces host bundle and separate worker bundle. |
| **Full Test Baseline**| Monorepo Root | `npm test` | All 15 existing test files + new test suites pass with 0 failures. |

---

*Plan formulated for PineOrca Frontend Shell Implementation (Candidate 3).*
