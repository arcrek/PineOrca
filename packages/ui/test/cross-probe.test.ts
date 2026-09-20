// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, vi } from 'vitest';
import {
    CrossProbeController,
    type ChartProbeTarget,
    type TradesTableProbeTarget,
    type MarkerLayerProbeTarget,
    type MarkerInteractionProbeTarget,
    type CrossProbeEvent,
} from '../src/controller/CrossProbeController.js';
import type { TradeRowItem } from '../src/tester/tabs/ListOfTradesTab.js';

describe('CrossProbeController — Bi-directional Event Synchronization', () => {
    function createMockChart(): {
        chart: ChartProbeTarget;
        markerLayer: MarkerLayerProbeTarget;
        markerInteraction: MarkerInteractionProbeTarget;
        hoverCallback: ((evt: { tradeId: string | null } | null) => void) | null;
        clickCallback: ((evt: { tradeId: string | null }) => void) | null;
    } {
        let hoverCb: ((evt: { tradeId: string | null } | null) => void) | null = null;
        let clickCb: ((evt: { tradeId: string | null }) => void) | null = null;

        const markerLayer: MarkerLayerProbeTarget = {
            setSelectedTradeId: vi.fn(),
            setHighlightedTradeId: vi.fn(),
        };

        const markerInteraction: MarkerInteractionProbeTarget = {
            onHover: vi.fn((cb) => {
                hoverCb = cb;
                return () => {
                    hoverCb = null;
                };
            }),
            onClick: vi.fn((cb) => {
                clickCb = cb;
                return () => {
                    clickCb = null;
                };
            }),
        };

        const chart: ChartProbeTarget = {
            centerOnTime: vi.fn(),
            centerOnLogical: vi.fn(),
            getMarkerLayer: () => markerLayer,
            getMarkerInteraction: () => markerInteraction,
        };

        return {
            chart,
            markerLayer,
            markerInteraction,
            get hoverCallback() {
                return hoverCb;
            },
            get clickCallback() {
                return clickCb;
            },
        };
    }

    function createMockTable(): {
        table: TradesTableProbeTarget;
        rowClickCallback: ((row: TradeRowItem) => void) | null;
        rowHoverCallback: ((row: TradeRowItem | null) => void) | null;
    } {
        let rowClickCb: ((row: TradeRowItem) => void) | null = null;
        let rowHoverCb: ((row: TradeRowItem | null) => void) | null = null;

        const table: TradesTableProbeTarget = {
            selectRow: vi.fn(),
            highlightRow: vi.fn(),
            scrollToTrade: vi.fn(),
            onRowClick: vi.fn((cb) => {
                rowClickCb = cb;
                return () => {
                    rowClickCb = null;
                };
            }),
            onRowHover: vi.fn((cb) => {
                rowHoverCb = cb;
                return () => {
                    rowHoverCb = null;
                };
            }),
        };

        return {
            table,
            get rowClickCallback() {
                return rowClickCb;
            },
            get rowHoverCallback() {
                return rowHoverCb;
            },
        };
    }

    it('table row click triggers camera pan event with matching timestamp within <10ms', () => {
        const mockChart = createMockChart();
        const mockTable = createMockTable();

        const controller = new CrossProbeController(mockChart.chart, mockTable.table);

        const events: CrossProbeEvent[] = [];
        controller.onSync((evt) => events.push(evt));

        const testTrade: TradeRowItem = {
            tradeId: 'TRADE_42',
            tradeIndex: 12,
            type: 'Entry Long',
            side: 'buy',
            kind: 'entry',
            signal: 'MomentumBreakout',
            time: 1715000000000,
            price: 152.5,
            contracts: 100,
            barIndex: 350,
        };

        // Simulate user clicking table row
        expect(mockTable.rowClickCallback).not.toBeNull();
        mockTable.rowClickCallback!(testTrade);

        // 1. Verify chart camera centered on the trade timestamp
        expect(mockChart.chart.centerOnTime).toHaveBeenCalledWith(1715000000000);

        // 2. Verify marker layer selected the trade marker
        expect(mockChart.markerLayer.setSelectedTradeId).toHaveBeenCalledWith('TRADE_42');

        // 3. Verify pulse glow is active
        expect(controller.getPulseGlowTradeId()).toBe('TRADE_42');

        // 4. Verify latency was measured and is well within 10ms
        expect(events).toHaveLength(1);
        const evt = events[0]!;
        expect(evt.source).toBe('table');
        expect(evt.action).toBe('select');
        expect(evt.tradeId).toBe('TRADE_42');
        expect(evt.timestamp).toBe(1715000000000);
        expect(evt.latencyMs).toBeDefined();
        expect(evt.latencyMs!).toBeLessThan(10); // Pass criteria: <10ms

        controller.detach();
    });

    it('table row hover highlights corresponding on-chart marker', () => {
        const mockChart = createMockChart();
        const mockTable = createMockTable();

        const controller = new CrossProbeController(mockChart.chart, mockTable.table);

        const testTrade: TradeRowItem = {
            tradeId: 'TRADE_99',
            tradeIndex: 25,
            type: 'Exit Short',
            side: 'buy',
            kind: 'exit',
            signal: 'StopLoss',
            time: 1716000000000,
            price: 98.2,
            contracts: 50,
        };

        // Hover row
        mockTable.rowHoverCallback!(testTrade);
        expect(mockChart.markerLayer.setHighlightedTradeId).toHaveBeenCalledWith('TRADE_99');

        // Un-hover row
        mockTable.rowHoverCallback!(null);
        expect(mockChart.markerLayer.setHighlightedTradeId).toHaveBeenCalledWith(null);

        controller.detach();
    });

    it('chart marker hover highlights corresponding row in trade table', () => {
        const mockChart = createMockChart();
        const mockTable = createMockTable();

        const controller = new CrossProbeController(mockChart.chart, mockTable.table);

        // Simulate hovering a chart marker
        expect(mockChart.hoverCallback).not.toBeNull();
        mockChart.hoverCallback!({ tradeId: 'TRADE_77' });
        expect(mockTable.table.highlightRow).toHaveBeenCalledWith('TRADE_77');

        // Hover leave
        mockChart.hoverCallback!(null);
        expect(mockTable.table.highlightRow).toHaveBeenCalledWith(null);

        controller.detach();
    });

    it('chart marker click selects and centers trade in table', () => {
        const mockChart = createMockChart();
        const mockTable = createMockTable();

        const controller = new CrossProbeController(mockChart.chart, mockTable.table);

        // Simulate clicking a chart marker
        expect(mockChart.clickCallback).not.toBeNull();
        mockChart.clickCallback!({ tradeId: 'TRADE_88' });

        expect(mockTable.table.selectRow).toHaveBeenCalledWith('TRADE_88');
        expect(mockTable.table.scrollToTrade).toHaveBeenCalledWith('TRADE_88');

        controller.detach();
    });

    it('cleanly unsubscribes all listeners on detach', () => {
        const mockChart = createMockChart();
        const mockTable = createMockTable();

        const controller = new CrossProbeController();
        controller.attach(mockChart.chart, mockTable.table);
        controller.detach();

        // Calling callbacks after detach should have no effect
        if (mockTable.rowClickCallback) {
            mockTable.rowClickCallback({
                tradeId: 'T1',
                tradeIndex: 1,
                type: 'Entry Long',
                side: 'buy',
                kind: 'entry',
                signal: 'Buy',
                time: 1000,
                price: 100,
                contracts: 1,
            });
        }
        // Since detach was called, centerOnTime was unhooked and should not have been called
        expect(mockChart.chart.centerOnTime).not.toHaveBeenCalled();
    });
});
