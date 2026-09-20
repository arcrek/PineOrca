---
phase: 5
title: "Dockable Strategy Tester & Monaco Pine Script IDE"
status: completed
priority: P1
effort: "7d"
dependencies: ["4"]
---

# Phase 5: Dockable Strategy Tester & Monaco Pine Script IDE

## Goal
Construct the TradingView-style dockable bottom panel containing the 3-tab Strategy Tester (Overview, Performance Summary, Virtualized List of Trades) and the Monaco Pine Script IDE with real-time compilation diagnostics.

## Files to Create / Modify
- Create: `packages/ui/src/dock/BottomDock.ts` (3-state dockable container: collapsed, split, maximized with drag resizer)
- Create: `packages/ui/src/tester/StrategyTester.ts` (Main tabbed container orchestrating Strategy Tester views)
- Create: `packages/ui/src/tester/tabs/OverviewTab.ts` (Canvas equity curve and underwater drawdown chart)
- Create: `packages/ui/src/tester/tabs/PerformanceSummaryTab.ts` (3-column financial table: All, Long, Short trades)
- Create: `packages/ui/src/tester/tabs/ListOfTradesTab.ts` (High-density `VirtualDataGrid` with row recycling for 10k+ trades)
- Create: `packages/ui/src/editor/MonacoPineEditor.ts` (Monaco editor with Pine v5/v6 syntax tokenizer and error squiggles)
- Create: `packages/ui/src/controller/CrossProbeController.ts` (Bi-directional selection and synchronization between table and chart)
- Create: `packages/ui/test/virtual-grid.test.ts` (Virtual data grid scroll and memory benchmark)
- Create: `packages/ui/test/cross-probe.test.ts` (Two-way event synchronization test suite)

## Tasks & Steps
1. **Dockable Container (`BottomDock.ts`)**:
   - Build a responsive dock below the chart with 3 operational states:
     - *Collapsed*: 36px summary pill bar showing Net PnL, Win Rate, and open positions.
     - *Split*: Default 340px split pane with draggable resizer handle.
     - *Maximized*: 100% full-screen view for deep analysis.
2. **Strategy Tester Tabs**:
   - **Overview Tab**:
     - Metric KPI Cards (Net Profit, Profit Factor, Win Rate, Max Drawdown %).
     - Interactive cumulative Equity Curve vs. Buy & Hold benchmark.
     - Underwater Drawdown area chart plotting peak-to-trough percentage drops.
   - **Performance Summary Tab**:
     - 3-column structured grid (All / Long / Short) comparing 30+ performance metrics (Net Profit, Gross Profit, Trade Count, Averages, Extremes, Streaks, Sharpe, Sortino, CAGR).
   - **List of Trades Tab (`VirtualDataGrid.ts`)**:
     - Virtualized table DOM recycling rendering only visible rows plus overscan buffer (supports 50,000+ trade rows at 60 FPS).
     - Columns: Trade #, Type, Signal/Comment, Date/Time, Price, Contracts, Profit ($ and %), Cumulative PnL, Run-up, Drawdown.
     - CSV export button to download the complete ledger.
3. **Bi-directional Cross-Probing (`CrossProbeController.ts`)**:
   - Clicking a trade row in the list commands Vela to pan/zoom, centering on the execution bar.
   - The corresponding on-chart trade marker displays a pulse glow animation.
   - Hovering an on-chart marker highlights the corresponding row in the trade table.
4. **Monaco Pine Script IDE (`MonacoPineEditor.ts`)**:
   - Embed Monaco Editor with custom Monarch syntax highlighting grammar for Pine Script v5/v6.
   - Hook parser diagnostics to Monaco marker squiggles (line number, column, error description).
   - Add action controls: "Save", "Add to Chart", "Update Strategy" (`Ctrl + Enter`).

## Verification
- `npx vitest run packages/ui/test/virtual-grid.test.ts`
  - *Pass criteria*: 20,000 trade row scroll benchmark maintains 60 FPS rendering with zero memory leaks.
- `npx vitest run packages/ui/test/cross-probe.test.ts`
  - *Pass criteria*: Table row click triggers camera pan event with matching timestamp within $<10\text{ms}$.
