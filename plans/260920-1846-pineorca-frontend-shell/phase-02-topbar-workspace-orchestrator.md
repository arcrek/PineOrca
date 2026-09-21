---
phase: 2
title: "Core Presentation Layer (@pineorca/ui) — TopBar & Workspace Layout Orchestrator"
status: complete
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Core Presentation Layer (@pineorca/ui) — TopBar & Workspace Layout Orchestrator

#### 1. Objectives
- Implement `TopBar`: institutional dark-theme control header with symbol, timeframe, strategy presets, run button, live stream toggle, and execution telemetry badge.
- Implement `PineOrcaWorkspace`: top-level layout coordinator mounting TopBar, Chart Host, and BottomDock (hosting StrategyTester and MonacoPineEditor).
- Implement responsive layout resizing between BottomDock and the Chart host using `ResizeObserver`.

#### 2. File Ownership & Exact Symbols
- **`packages/ui/src/topbar/TopBar.ts`**:
  - Class: `TopBar`.
  - Interfaces: `TopBarOptions`, `TopBarStatus`, `TopBarMetrics`.
  - Methods: `mount(container: HTMLElement): void`, `destroy(): void`, `setStatus(status: TopBarStatus, meta?: string): void`, `setMetrics(metrics: TopBarMetrics): void`, `setStreaming(isStreaming: boolean): void`.
  - Events: `onRunBacktest(cb: () => void)`, `onToggleStreaming(cb: (active: boolean) => void)`, `onSymbolChange(cb: (sym: string) => void)`, `onTimeframeChange(cb: (tf: string) => void)`, `onPresetChange(cb: (presetId: string) => void)`.
- **`packages/ui/src/workspace/PineOrcaWorkspace.ts`**:
  - Class: `PineOrcaWorkspace`.
  - Interfaces: `PineOrcaWorkspaceOptions`.
  - Methods: `mount(container: HTMLElement): void`, `destroy(): void`, `getTopBar(): TopBar`, `getChartContainer(): HTMLElement`, `getBottomDock(): BottomDock`, `getStrategyTester(): StrategyTester`, `getEditor(): MonacoPineEditor`, `getCrossProbeController(): CrossProbeController`.
- **`packages/ui/src/index.ts`**:
  - Export `TopBar`, `TopBarOptions`, `TopBarStatus`.
  - Export `PineOrcaWorkspace`, `PineOrcaWorkspaceOptions`.
- **`packages/ui/test/topbar.test.ts`**:
  - Unit tests covering TopBar rendering, state transitions, callbacks, and button disabled states.
- **`packages/ui/test/workspace.test.ts`**:
  - Unit tests covering Workspace DOM composition, resize propagation, dock docking, and component accessors.

#### 3. Step-by-Step Implementation Tasks
1. Create `packages/ui/src/topbar/TopBar.ts`:
   - Implement DOM construction matching TradingView `#131722` styling.
   - Build symbol `<select>`, timeframe buttons, strategy preset selector.
   - Build "Run Backtest" button with loading spinner state and blue accent styling (`#2962ff`).
   - Build "Live Stream" button with animated green dot (`#089981`).
   - Build status badge and duration/bars metric pill.
   - Bind event listeners and export clean subscription methods returning unbind closures.
2. Create `packages/ui/src/workspace/PineOrcaWorkspace.ts`:
   - Construct root flex column container (`100vw`, `100vh`).
   - Mount `TopBar` into the top slot.
   - Create `mainArea` with `position: relative` and `flex: 1`.
   - Create `chartHost` div with `width: 100%`, `height: 100%`.
   - Instantiate `BottomDock`, `StrategyTester`, `MonacoPineEditor`, and `CrossProbeController`.
   - Register `StrategyTester` as tab `'tester'` ("Strategy Tester") and `MonacoPineEditor` as tab `'editor'` ("Pine Editor") in `BottomDock`.
   - Mount `BottomDock` into `mainArea`.
   - Connect `BottomDock.onHeightChange` and `BottomDock.onStateChange` to resize callbacks.
3. Update `packages/ui/src/index.ts` to export `TopBar` and `PineOrcaWorkspace`.
4. Create `packages/ui/test/topbar.test.ts` using `setupTestDOM`:
   - Test mounting, button clicks, status transitions (`idle` -> `running` -> `streaming`), and unbinding.
5. Create `packages/ui/test/workspace.test.ts` using `setupTestDOM`:
   - Test workspace mounting, dock height changes, sub-component accessors, and clean destruction without DOM leaks.

#### 4. Verification Commands
```bash
# Run TopBar and Workspace headless component tests
npx vitest run packages/ui/test/topbar.test.ts packages/ui/test/workspace.test.ts

# Verify existing UI component tests continue passing
npx vitest run packages/ui/test/components.test.ts packages/ui/test/cross-probe.test.ts
```

---
