---
phase: 3
title: "Chart Viewport Centering & CrossProbe Synchronization Engine"
status: complete
priority: P1
effort: "1d"
dependencies: [2]
---

# Phase 3: Chart Viewport Centering & CrossProbe Synchronization Engine

#### 1. Objectives
- Implement `centerOnTime(timestamp: number)` on `VelaChartAdapter` to allow programmatic navigation of the WebGL chart viewport.
- Implement `pulseGlow(tradeId: string)` on `VelaChartAdapter` / `TradeMarkerLayer` to visually pinpoint trade execution bars on user selection.
- Connect `CrossProbeController` between `VelaChartAdapter` and `ListOfTradesTab` with bidirectional hover and selection synchronization.
- Verify sub-16ms synchronization latency, zero memory churn, and re-entrancy protection.

#### 2. File Ownership & Exact Symbols
- **`packages/chart/src/VelaChartAdapter.ts`**:
  - Symbol: `VelaChartAdapter.centerOnTime(timestamp: number): void`.
  - Symbol: `VelaChartAdapter.pulseGlow(tradeId: string): void`.
  - Symbol: `VelaChartAdapter.updateCandle(bar: { time: number; open: number; high: number; low: number; close: number; volume: number }): void`.
- **`packages/chart/src/markers/TradeMarkerLayer.ts`**:
  - Symbol: `TradeMarkerLayer.pulseGlow(tradeId: string): void`.
  - Symbol: `TradeMarkerLayer.getActivePulsingTradeId(): string | null`.
- **`packages/chart/src/index.ts`**:
  - Re-export updated interfaces and methods.
- **`packages/chart/test/crossprobe-sync.test.ts`**:
  - End-to-end integration test validating table-to-chart centering, chart-to-table scrolling, hover halo rendering, and latency benchmarks.

#### 3. Step-by-Step Implementation Tasks
1. In `packages/chart/src/VelaChartAdapter.ts`:
   - Implement `centerOnTime(timestamp: number)`:
     - Check if `this.vela` is instantiated.
     - Extract current visible time range: if available via `this.vela.getVisibleRange()`, compute span $\Delta t = \text{to} - \text{from}$. Otherwise default to 100 bars $\times$ timeframe duration.
     - Set new visible range centered on timestamp:
       ```ts
       const halfSpan = span / 2;
       (this.vela as any).setVisibleRange?.({ from: timestamp - halfSpan, to: timestamp + halfSpan });
       ```
     - Request marker repaint via `this.requestMarkerRepaint()`.
   - Implement `pulseGlow(tradeId: string)`:
     - Forward to `this.markerLayer.pulseGlow(tradeId)`.
     - Trigger RAF repaint loop for 300ms.
   - Implement `updateCandle(bar)`:
     - Efficiently update the active/forming candle in the Vela chart data series.
2. In `packages/chart/src/markers/TradeMarkerLayer.ts`:
   - Add state `pulsingTradeId: string | null = null` and `pulseStartTime: number = 0`.
   - In `render(ctx, layout)`:
     - If `pulsingTradeId` matches current marker, calculate animation progress $p = (now - start) / 300$.
     - If $p < 1$, draw an expanding outer pulse circle (`radius = baseRadius + p * 12`, `alpha = (1 - p) * 0.8`).
3. In `packages/ui/src/controller/CrossProbeController.ts`:
   - Verify `centerOnTime` is called on row click (`chart.centerOnTime(row.time)`).
   - Add call to `chart.pulseGlow(row.tradeId)` if available.
4. Create `packages/chart/test/crossprobe-sync.test.ts`:
   - Mock Vela chart and `ListOfTradesTab`.
   - Attach `CrossProbeController`.
   - Test table row click triggers `centerOnTime` and `pulseGlow`.
   - Test chart marker click triggers `selectRow` and `scrollToTrade`.
   - Measure latency: assert round-trip synchronization executes in $<10\text{ms}$.

#### 4. Verification Commands
```bash
# Run CrossProbe synchronization and latency benchmark tests
npx vitest run packages/chart/test/crossprobe-sync.test.ts

# Verify all chart marker interaction tests pass
npx vitest run packages/chart/test/trade-markers.test.ts packages/chart/test/scene-translator.test.ts
```

---
