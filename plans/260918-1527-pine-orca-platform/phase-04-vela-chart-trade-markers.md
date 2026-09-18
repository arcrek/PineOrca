---
phase: 4
title: "Vela WebGL2 Chart Integration & Trade Marker Subsystem"
status: pending
priority: P1
effort: "5d"
dependencies: ["3"]
---

# Phase 4: Vela WebGL2 Chart Integration & Trade Marker Subsystem

## Goal
Mount the Vela WebGL2 chart engine, establish multi-pane layout routing, translate Pine script outputs into renderer-neutral scenes, and render interactive `TradeExecution` overlays directly on the price pane.

## Files to Create / Modify
- Create: `packages/chart/src/VelaChartAdapter.ts` (Wrapper initializing `Vela` instance, viewport state, and resize observers)
- Create: `packages/chart/src/markers/TradeMarkerLayer.ts` (Canvas overlay rendering TV-identical entry/exit arrows, price ticks, and badges)
- Create: `packages/chart/src/markers/TradeMarkerInteraction.ts` (Hit-testing and hover tooltip controller for executed trades)
- Create: `packages/chart/src/scene/SceneTranslator.ts` (Transforms engine `PineRun` into Vela `IndicatorModel` and `TradeExecution[]`)
- Create: `packages/chart/test/scene-translator.test.ts` (Plot, fill, drawing, and execution translation test suite)
- Create: `packages/chart/test/trade-markers.test.ts` (Marker layout and collision stacking unit tests)

## Tasks & Steps
1. **Vela Core Mount & Lifecycle Management**:
   - Initialize `@luxalgo/vela` `Vela` instance connected to the application DOM container.
   - Configure WebGL2 renderer with Canvas2D fallback and theme token mapping (`--vela-surface`, `--vela-border`, `--vela-accent`).
   - Implement dynamic pane routing: overlay indicators route to `'price'`, oscillators route to `'new'` subpanes.
2. **Scene Translation (`SceneTranslator.ts`)**:
   - Port and extend `toScene.ts` from `/tmp/Vela-pinets`.
   - Map PineTS plots to Vela series types (line, histogram, columns, crosses, circles).
   - Translate bands (`fill`), price lines (`hline`), backgrounds (`bgcolor`), and drawings (`DrawingLine`, `DrawingBox`, `DrawingLabel`, `DrawingPolyline`, `DrawingTable`).
   - Convert PineTS broker ledger trades into merged `TradeExecution` records: combine multiple FIFO lots of the same fill order into a single marker at the execution price.
3. **Trade Marker Visuals & Interaction Layer**:
   - Implement `TradeMarkerLayer` drawing direction arrows:
     - Long Entry: Green arrow ($\uparrow$) below candle low with order ID/comment and quantity badge.
     - Short Entry: Red arrow ($\downarrow$) above candle high with order ID/comment and quantity badge.
     - Exit Orders: Arrow capped with a transverse bar.
   - Implement price ticks anchoring the marker to the exact execution price on the candle edge.
   - Implement marker hit-testing: hovering over a trade marker highlights the trade on the chart and emits an event to the Strategy Tester.

## Verification
- `npx vitest run packages/chart/test/scene-translator.test.ts`
  - *Pass criteria*: 100% fidelity mapping complex multi-plot indicators and trade execution arrays to Vela's `IndicatorModel`.
- `npx vitest run packages/chart/test/trade-markers.test.ts`
  - *Pass criteria*: Visual coordinates match fill bars; stacked markers on the same bar offset correctly without visual clipping.
