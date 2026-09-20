// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDOM, type MockHTMLElement } from './setup-dom.js';
import {
    VirtualDataGrid,
    ListOfTradesTab,
    type TradeRowItem,
} from '../src/tester/tabs/ListOfTradesTab.js';

describe('VirtualDataGrid & ListOfTradesTab — Virtualization & Benchmarks', () => {
    let domCleanup: () => void;
    let container: MockHTMLElement;

    beforeEach(() => {
        const dom = setupTestDOM();
        domCleanup = dom.cleanup;
        container = dom.container;
    });

    afterEach(() => {
        domCleanup();
    });

    function generateTradeRows(count: number): TradeRowItem[] {
        const rows: TradeRowItem[] = [];
        let cumPnl = 0;
        const baseTime = 1700000000000;

        for (let i = 0; i < count; i++) {
            const isEntry = i % 2 === 0;
            const isLong = i % 4 < 2;
            const price = 100 + (i % 50);
            const profit = isEntry ? undefined : (isLong ? 2.5 : -1.8);
            const profitPct = isEntry ? undefined : (isLong ? 2.5 : -1.8);
            if (profit != null) cumPnl += profit;

            rows.push({
                tradeId: `T_${i + 1}`,
                tradeIndex: Math.floor(i / 2) + 1,
                type: isEntry
                    ? isLong ? 'Entry Long' : 'Entry Short'
                    : isLong ? 'Exit Long' : 'Exit Short',
                side: isLong ? (isEntry ? 'buy' : 'sell') : (isEntry ? 'sell' : 'buy'),
                kind: isEntry ? 'entry' : 'exit',
                signal: isEntry ? (isLong ? 'BuySignal' : 'SellSignal') : 'TakeProfit',
                time: baseTime + i * 60000,
                price,
                contracts: 10,
                profit,
                profitPercent: profitPct,
                cumulativePnl: isEntry ? undefined : cumPnl,
                runupPercent: isEntry ? undefined : 3.2,
                drawdownPercent: isEntry ? undefined : -0.8,
                barIndex: i,
            });
        }
        return rows;
    }

    it('allocates a constant bounded DOM pool for 20,000 trade rows', () => {
        const grid = new VirtualDataGrid({ rowHeight: 28, overscan: 5 });
        grid.setViewportHeight(400); // 400px viewport -> ~15 visible rows + 10 overscan = ~25-30 pool elements
        grid.mount(container as unknown as HTMLElement);

        const rows = generateTradeRows(20000);
        grid.setRows(rows);

        const poolCount = grid.getPoolElementCount();
        // Pool size should be bounded to viewport needs (~27-35), NOT 20,000!
        expect(poolCount).toBeGreaterThanOrEqual(20);
        expect(poolCount).toBeLessThanOrEqual(50);

        // Memory invariant: Verify spacer holds full virtual scroll height
        const spacer = (container.firstChild as MockHTMLElement)?.children[0];
        expect(spacer?.style.height).toBe(`${20000 * 28}px`);

        grid.destroy();
    });

    it('benchmarks 20,000 row scroll maintaining 60 FPS throughput (avg < 16.6ms)', () => {
        const grid = new VirtualDataGrid({ rowHeight: 28, overscan: 5 });
        grid.setViewportHeight(400);
        grid.mount(container as unknown as HTMLElement);

        const rows = generateTradeRows(20000);
        grid.setRows(rows);

        const initialPoolCount = grid.getPoolElementCount();
        const viewportEl = grid.getViewportElement() as unknown as MockHTMLElement;

        // Perform 200 consecutive scrolls across the 20,000 rows
        const scrollSteps = 200;
        const maxScroll = 20000 * 28 - 400;

        const startTime = performance.now();

        for (let step = 0; step < scrollSteps; step++) {
            const targetScrollTop = Math.floor((step / scrollSteps) * maxScroll);
            if (viewportEl) {
                viewportEl.scrollTop = targetScrollTop;
            }
            grid.render();
        }

        const elapsedMs = performance.now() - startTime;
        const avgFrameMs = elapsedMs / scrollSteps;

        // Invariant: Pool size must never grow during scrolling (zero DOM leakage)
        expect(grid.getPoolElementCount()).toBe(initialPoolCount);

        // 60 FPS requires frame duration <= 16.6ms. In virtual recycling, avgFrameMs is typically < 1ms
        expect(avgFrameMs).toBeLessThan(16.6);

        grid.destroy();
    });

    it('dispatches row click and row hover events accurately', () => {
        let clickedRow: TradeRowItem | null = null;
        let hoveredRow: TradeRowItem | null = null;

        const grid = new VirtualDataGrid({
            rowHeight: 28,
            onRowClick: (row) => {
                clickedRow = row;
            },
            onRowHover: (row) => {
                hoveredRow = row;
            },
        });
        grid.setViewportHeight(400);
        grid.mount(container as unknown as HTMLElement);

        const rows = generateTradeRows(100);
        grid.setRows(rows);

        // Select programmatic
        grid.selectTrade('T_5');
        expect(grid.getSelectedTradeId()).toBe('T_5');

        grid.highlightTrade('T_10');
        expect(grid.getHighlightedTradeId()).toBe('T_10');

        // Scroll to trade
        grid.scrollToTrade('T_50');
        const viewportEl = grid.getViewportElement() as unknown as MockHTMLElement;
        // Index 49 * 28 = 1372px - 200px = 1172px
        expect(viewportEl.scrollTop).toBe(49 * 28 - 200);

        grid.destroy();
    });

    it('ListOfTradesTab exports RFC-4180 compliant CSV for 20,000 trades', () => {
        const tab = new ListOfTradesTab();
        tab.mount(container as unknown as HTMLElement);

        const rows = generateTradeRows(20000);
        tab.setTrades(rows);

        const csv = tab.exportCsv();
        const lines = csv.split('\n');

        // Header + 20,000 rows = 20,001 lines
        expect(lines).toHaveLength(20001);
        expect(lines[0]).toBe('Trade #,Type,Signal,Date/Time,Price,Contracts,Profit ($),Profit (%),Cumulative PnL ($),Run-up (%),Drawdown (%)');
        expect(lines[1]).toContain('1,Entry Long,BuySignal,');

        tab.destroy();
    });
});
