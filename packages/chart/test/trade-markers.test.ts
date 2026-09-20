import { describe, it, expect } from 'vitest';
import type { TradeExecution } from '@luxalgo/vela/plugin';
import {
    TradeMarkerLayer,
    BAR_GAP,
    ARROW_H,
    UNIT_GAP,
    TICK_W,
    DEFAULT_LONG_COLOR,
    DEFAULT_SHORT_COLOR,
    DEFAULT_EXIT_COLOR,
    type TradeMarkerDeps,
} from '../src/markers/TradeMarkerLayer';
import { TradeMarkerInteraction } from '../src/markers/TradeMarkerInteraction';

describe('TradeMarkerLayer — Layout and Visual Geometry', () => {
    const mockDeps: TradeMarkerDeps = {
        timeToLogical: (ms: number) => (ms - 1000) / 1000,
        logicalToX: (logical: number) => 100 + logical * 50,
        priceToY: (price: number) => 500 - price * 2, // e.g. price 100 -> y = 300, price 110 -> y = 280
        barAt: (logical: number) => {
            if (logical === 0) return { open: 100, high: 105, low: 95, close: 102 };
            if (logical === 1) return { open: 102, high: 112, low: 101, close: 110 };
            return null;
        },
        barBodyHalfWidth: 8,
    };

    it('positions long entry below candle low with green up arrow', () => {
        const layer = new TradeMarkerLayer();
        const trades: TradeExecution[] = [
            {
                time: 1000, // logical 0
                price: 98,
                side: 'buy',
                kind: 'entry',
                label: 'BuySignal',
                qty: 10,
                tradeId: 'T1',
            },
        ];
        layer.setTrades(trades);

        const units = layer.computeLayout(mockDeps);
        expect(units).toHaveLength(1);

        const unit = units[0]!;
        expect(unit.side).toBe('buy');
        expect(unit.kind).toBe('entry');
        expect(unit.color).toBe(DEFAULT_LONG_COLOR);
        expect(unit.x).toBe(100); // logical 0 -> 100

        // Candle low is 95 -> priceToY(95) = 500 - 190 = 310
        // Buy tip must be at candle low Y + BAR_GAP = 310 + 10 = 320
        expect(unit.tipY).toBe(320);
        expect(unit.arrowY).toBe(320);

        // Price tick anchors to candle left edge at exact fill price (98 -> y = 304)
        expect(unit.tick).toBeDefined();
        expect(unit.tick?.y1).toBe(304);
        expect(unit.tick?.y2).toBe(304);
        expect(unit.tick?.x1).toBe(100 - 8); // 92
        expect(unit.tick?.x2).toBe(100 - 8 - TICK_W); // 86

        // Label and quantity text
        expect(unit.lines).toEqual(['BuySignal', '+10']);
    });

    it('positions short entry above candle high with red down arrow', () => {
        const layer = new TradeMarkerLayer();
        const trades: TradeExecution[] = [
            {
                time: 1000, // logical 0
                price: 104,
                side: 'sell',
                kind: 'entry',
                label: 'ShortSignal',
                qty: 5,
                tradeId: 'T2',
            },
        ];
        layer.setTrades(trades);

        const units = layer.computeLayout(mockDeps);
        expect(units).toHaveLength(1);

        const unit = units[0]!;
        expect(unit.side).toBe('sell');
        expect(unit.kind).toBe('entry');
        expect(unit.color).toBe(DEFAULT_SHORT_COLOR);

        // Candle high is 105 -> priceToY(105) = 500 - 210 = 290
        // Sell tip must be at candle high Y - BAR_GAP = 290 - 10 = 280
        expect(unit.tipY).toBe(280);
        expect(unit.arrowY).toBe(280 - ARROW_H); // 266

        // Price tick anchors to candle right edge at exact fill price (104 -> y = 292)
        expect(unit.tick).toBeDefined();
        expect(unit.tick?.y1).toBe(292);
        expect(unit.tick?.x1).toBe(100 + 8); // 108
        expect(unit.tick?.x2).toBe(100 + 8 + TICK_W); // 114

        expect(unit.lines).toEqual(['ShortSignal', '-5']);
    });

    it('formats exit orders with exit color', () => {
        const layer = new TradeMarkerLayer();
        const trades: TradeExecution[] = [
            {
                time: 1000,
                price: 102,
                side: 'sell',
                kind: 'exit',
                label: 'CloseLong',
                qty: 10,
                tradeId: 'T1',
            },
        ];
        layer.setTrades(trades);

        const units = layer.computeLayout(mockDeps);
        expect(units).toHaveLength(1);
        expect(units[0]?.kind).toBe('exit');
        expect(units[0]?.color).toBe(DEFAULT_EXIT_COLOR);
    });

    it('stacks multiple fills on the same bar outward without visual collision', () => {
        const layer = new TradeMarkerLayer();
        // 3 buy fills and 2 sell fills on the same bar (logical 0)
        const trades: TradeExecution[] = [
            { time: 1000, price: 96, side: 'buy', kind: 'entry', label: 'Buy_1', qty: 1, tradeId: 'T1' },
            { time: 1000, price: 97, side: 'buy', kind: 'entry', label: 'Buy_2', qty: 2, tradeId: 'T2' },
            { time: 1000, price: 98, side: 'buy', kind: 'entry', label: 'Buy_3', qty: 3, tradeId: 'T3' },
            { time: 1000, price: 103, side: 'sell', kind: 'entry', label: 'Sell_1', qty: 1, tradeId: 'T4' },
            { time: 1000, price: 104, side: 'sell', kind: 'entry', label: 'Sell_2', qty: 2, tradeId: 'T5' },
        ];
        layer.setTrades(trades);

        const units = layer.computeLayout(mockDeps);
        expect(units).toHaveLength(5);

        const buys = units.filter((u) => u.side === 'buy');
        expect(buys).toHaveLength(3);

        // Verify downward stacking order: buy[0].y < buy[1].y < buy[2].y
        expect(buys[0]!.bounds.y).toBeLessThan(buys[1]!.bounds.y);
        expect(buys[1]!.bounds.y).toBeLessThan(buys[2]!.bounds.y);

        // Verify NO overlapping of bounding boxes among buys
        const buy0Bottom = buys[0]!.bounds.y + buys[0]!.bounds.height;
        expect(buys[1]!.bounds.y).toBeGreaterThanOrEqual(buy0Bottom + UNIT_GAP - 0.01);

        const buy1Bottom = buys[1]!.bounds.y + buys[1]!.bounds.height;
        expect(buys[2]!.bounds.y).toBeGreaterThanOrEqual(buy1Bottom + UNIT_GAP - 0.01);

        // Verify upward stacking order: sell[0].y > sell[1].y (further away from candle high)
        const sells = units.filter((u) => u.side === 'sell');
        expect(sells).toHaveLength(2);
        expect(sells[0]!.bounds.y).toBeGreaterThan(sells[1]!.bounds.y);

        const sell1Bottom = sells[1]!.bounds.y + sells[1]!.bounds.height;
        expect(sells[0]!.bounds.y).toBeGreaterThanOrEqual(sell1Bottom + UNIT_GAP - 0.01);
    });

    it('renders on a Canvas2D context without throwing errors', () => {
        const layer = new TradeMarkerLayer();
        layer.setTrades([
            { time: 1000, price: 98, side: 'buy', kind: 'entry', label: 'B', qty: 1, tradeId: 'T1' },
            { time: 1000, price: 104, side: 'sell', kind: 'exit', label: 'S', qty: 1, tradeId: 'T1' },
        ]);
        layer.computeLayout(mockDeps);

        // Mock canvas context
        const calls: string[] = [];
        const mockCtx = {
            save: () => calls.push('save'),
            restore: () => calls.push('restore'),
            beginPath: () => calls.push('beginPath'),
            closePath: () => calls.push('closePath'),
            moveTo: () => calls.push('moveTo'),
            lineTo: () => calls.push('lineTo'),
            fill: () => calls.push('fill'),
            stroke: () => calls.push('stroke'),
            strokeRect: () => calls.push('strokeRect'),
            fillText: () => calls.push('fillText'),
            font: '',
            textAlign: '',
            textBaseline: '',
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
        } as unknown as CanvasRenderingContext2D;

        expect(() => layer.render(mockCtx, 800, 600)).not.toThrow();
        expect(calls.length).toBeGreaterThan(10);
    });
});

describe('TradeMarkerInteraction — Hit-Testing and Tooltip Events', () => {
    const mockDeps: TradeMarkerDeps = {
        timeToLogical: (ms: number) => (ms - 1000) / 1000,
        logicalToX: (logical: number) => 100 + logical * 50,
        priceToY: (price: number) => 500 - price * 2,
        barAt: () => ({ open: 100, high: 110, low: 90, close: 105 }),
        barBodyHalfWidth: 8,
    };

    it('hit-tests marker accurately within bounding box', () => {
        const layer = new TradeMarkerLayer();
        const trades: TradeExecution[] = [
            {
                time: 1000,
                price: 100,
                side: 'buy',
                kind: 'entry',
                label: 'SignalLong',
                qty: 25,
                tradeId: 'TRADE_42',
            },
        ];
        layer.setTrades(trades);
        const [unit] = layer.computeLayout(mockDeps);
        expect(unit).toBeDefined();

        const interaction = new TradeMarkerInteraction(layer);

        // Inside bounding box
        const hitX = unit!.bounds.x + unit!.bounds.width / 2;
        const hitY = unit!.bounds.y + unit!.bounds.height / 2;
        const hit = interaction.hitTest(hitX, hitY);
        expect(hit).not.toBeNull();
        expect(hit?.execution.tradeId).toBe('TRADE_42');

        // Outside bounding box
        const miss = interaction.hitTest(0, 0);
        expect(miss).toBeNull();
    });

    it('emits hover event with structured tooltip data on pointer move', () => {
        const layer = new TradeMarkerLayer();
        layer.setTrades([
            {
                time: 1000,
                price: 102.5,
                side: 'buy',
                kind: 'entry',
                label: 'MyEntry',
                qty: 10,
                tradeId: 'TRADE_99',
            },
        ]);
        const [unit] = layer.computeLayout(mockDeps);
        const interaction = new TradeMarkerInteraction(layer);

        let receivedEvent: unknown = null;
        interaction.onHover((e) => {
            receivedEvent = e;
        });

        const hitX = unit!.bounds.x + unit!.bounds.width / 2;
        const hitY = unit!.bounds.y + unit!.bounds.height / 2;
        interaction.handlePointerMove(hitX, hitY);

        expect(receivedEvent).not.toBeNull();
        const evt = receivedEvent as { tradeId: string; tooltip: { title: string; price: number; qty: number } };
        expect(evt.tradeId).toBe('TRADE_99');
        expect(evt.tooltip.price).toBe(102.5);
        expect(evt.tooltip.qty).toBe(10);
        expect(evt.tooltip.title).toContain('Buy Entry');

        // Pointer move outside clears hover
        interaction.handlePointerMove(0, 0);
        expect(receivedEvent).toBeNull();
    });

    it('emits click event on marker click', () => {
        const layer = new TradeMarkerLayer();
        layer.setTrades([
            {
                time: 1000,
                price: 102.5,
                side: 'sell',
                kind: 'exit',
                label: 'ExitLong',
                qty: 10,
                tradeId: 'TRADE_99',
            },
        ]);
        const [unit] = layer.computeLayout(mockDeps);
        const interaction = new TradeMarkerInteraction(layer);

        let clickedTradeId: string | null = null;
        interaction.onClick((e) => {
            clickedTradeId = e.tradeId;
        });

        const hitX = unit!.bounds.x + unit!.bounds.width / 2;
        const hitY = unit!.bounds.y + unit!.bounds.height / 2;
        interaction.handlePointerClick(hitX, hitY);

        expect(clickedTradeId).toBe('TRADE_99');
    });

    it('cross-probing highlight and selection update marker states', () => {
        const layer = new TradeMarkerLayer();
        layer.setTrades([
            { time: 1000, price: 100, side: 'buy', kind: 'entry', tradeId: 'T1' },
            { time: 1000, price: 105, side: 'sell', kind: 'entry', tradeId: 'T2' },
        ]);
        layer.computeLayout(mockDeps);

        const interaction = new TradeMarkerInteraction(layer);
        interaction.highlightTrade('T1');

        const layout = layer.getLayout();
        const t1 = layout.find((u) => u.execution.tradeId === 'T1');
        const t2 = layout.find((u) => u.execution.tradeId === 'T2');

        expect(t1?.highlighted).toBe(true);
        expect(t2?.highlighted).toBe(false);

        interaction.selectTrade('T2');
        expect(t1?.selected).toBe(false);
        expect(t2?.selected).toBe(true);
    });
});
