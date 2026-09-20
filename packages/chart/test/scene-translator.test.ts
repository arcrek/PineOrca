import { describe, it, expect } from 'vitest';
import type { LineLikeSeries } from '@luxalgo/vela/plugin';
import { SceneTranslator, toScene } from '../src/scene/SceneTranslator';
import { normalizeContext } from '../src/scene/normalizeContext';
import { VelaChartAdapter } from '../src/VelaChartAdapter';
import type { PineRun, PinePlot, PineTrade } from '../src/scene/types';

describe('SceneTranslator — PineRun to IndicatorModel', () => {
    it('translates EMA overlay line with null for leading na values', () => {
        const run: PineRun = {
            meta: { title: 'EMA', overlay: true, precision: 2 },
            plots: [
                {
                    key: 'plot_0',
                    title: 'EMA',
                    style: 'line',
                    options: { color: '#ff9800', linewidth: 2 },
                    data: [
                        { time: 1000, value: null },
                        { time: 2000, value: null },
                        { time: 3000, value: 105.5 },
                        { time: 4000, value: 106.2 },
                    ],
                },
            ],
        };

        const { model, warnings } = toScene(run, 'ind-ema');
        expect(warnings).toHaveLength(0);
        expect(model.id).toBe('ind-ema');
        expect(model.title).toBe('EMA');
        expect(model.overlay).toBe(true);
        expect(model.paneHint).toBe('price');
        expect(model.series).toHaveLength(1);

        const s = model.series[0] as LineLikeSeries;
        expect(s.kind).toBe('line');
        expect(s.title).toBe('EMA');
        expect(s.points).toHaveLength(4);
        expect(s.points[0]?.value).toBeNull();
        expect(s.points[1]?.value).toBeNull();
        expect(s.points[2]?.value).toBe(105.5);
        expect(s.points[3]?.value).toBe(106.2);
        expect(s.style.color).toBe('#ff9800');
        expect(s.style.width).toBe(2);
    });

    it('translates MACD study oscillator with histogram and lines', () => {
        const run: PineRun = {
            meta: { title: 'MACD', overlay: false },
            plots: [
                {
                    key: 'p_macd',
                    title: 'MACD',
                    style: 'line',
                    options: { color: '#2962ff' },
                    data: [{ time: 1000, value: 1.2 }],
                },
                {
                    key: 'p_signal',
                    title: 'Signal',
                    style: 'line',
                    options: { color: '#ff6d00' },
                    data: [{ time: 1000, value: 0.9 }],
                },
                {
                    key: 'p_hist',
                    title: 'Histogram',
                    style: 'style_histogram',
                    options: { color: '#26a69a', histbase: 0 },
                    data: [{ time: 1000, value: 0.3 }],
                },
            ],
        };

        const { model } = SceneTranslator.translate(run, 'ind-macd');
        expect(model.overlay).toBe(false);
        expect(model.paneHint).toBe('new');
        expect(model.series).toHaveLength(3);

        const kinds = model.series.map((s) => s.kind).sort();
        expect(kinds).toEqual(['histogram', 'line', 'line']);
        const hist = model.series.find((s) => s.kind === 'histogram') as LineLikeSeries;
        expect(hist.title).toBe('Histogram');
        expect(hist.style.base).toBe(0);
    });

    it('translates price lines (hline), fills, and backgrounds', () => {
        const run: PineRun = {
            meta: { title: 'Bands & Fill', overlay: false },
            plots: [
                {
                    key: 'p1',
                    title: 'Upper',
                    style: 'line',
                    options: { color: '#4caf50' },
                    data: [{ time: 1000, value: 120 }],
                },
                {
                    key: 'p2',
                    title: 'Lower',
                    style: 'line',
                    options: { color: '#f44336' },
                    data: [{ time: 1000, value: 80 }],
                },
                {
                    key: 'f1',
                    style: 'fill',
                    plot1: 'p1',
                    plot2: 'p2',
                    options: { color: 'rgba(76, 175, 80, 0.2)' },
                    data: [],
                },
                {
                    key: 'h1',
                    style: 'hline',
                    options: { price: 100, color: '#9e9e9e', linestyle: 'dashed' },
                    data: [],
                },
                {
                    key: 'bg1',
                    style: 'background',
                    options: {},
                    data: [
                        { time: 1000, value: true, options: { color: 'rgba(33, 150, 243, 0.1)' } },
                        { time: 2000, value: true, options: { color: 'rgba(33, 150, 243, 0.1)' } },
                    ],
                },
            ],
        };

        const { model } = toScene(run, 'ind-bands');
        expect(model.priceLines).toHaveLength(1);
        expect(model.priceLines[0]?.price).toBe(100);
        expect(model.priceLines[0]?.lineStyle).toBe('dashed');

        expect(model.fills).toHaveLength(1);
        const fill = model.fills[0]!;
        expect(fill.fromSeriesId).toBe(model.series[0]?.id);
        expect(fill.toSeriesId).toBe(model.series[1]?.id);

        expect(model.backgrounds).toHaveLength(1);
        expect(model.backgrounds[0]?.from).toBe(1000);
    });

    it('translates drawing objects (lines, boxes, labels, tables)', () => {
        const run: PineRun = {
            meta: { title: 'Drawings Test', overlay: true },
            plots: [
                {
                    key: '__lines__',
                    style: 'drawing_line',
                    options: {},
                    data: [
                        {
                            time: 1000,
                            value: [
                                { id: 1, x1: 1000, y1: 100, x2: 2000, y2: 110, color: '#ff0000', width: 2 },
                            ],
                        },
                    ],
                },
                {
                    key: '__boxes__',
                    style: 'drawing_box',
                    options: {},
                    data: [
                        {
                            time: 1000,
                            value: [
                                { id: 1, left: 1000, top: 120, right: 2000, bottom: 90, bgcolor: '#00ff00' },
                            ],
                        },
                    ],
                },
                {
                    key: '__labels__',
                    style: 'label',
                    options: {},
                    data: [
                        {
                            time: 1000,
                            value: [
                                { id: 1, x: 1000, y: 105, text: 'Pivot High', style: 'label_down', color: '#0000ff' },
                            ],
                        },
                    ],
                },
                {
                    key: '__tables__',
                    style: 'table',
                    options: {},
                    data: [
                        {
                            time: 1000,
                            value: [
                                {
                                    id: 1,
                                    columns: 2,
                                    rows: 1,
                                    position: 'top_right',
                                    cells: [
                                        { col: 0, row: 0, text: 'RSI' },
                                        { col: 1, row: 0, text: '68.5' },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const { model } = toScene(run, 'ind-drawings');
        expect(model.lines).toHaveLength(1);
        expect(model.lines[0]?.x1).toBe(1000);
        expect(model.lines[0]?.y2).toBe(110);

        expect(model.boxes).toHaveLength(1);
        expect(model.boxes[0]?.left).toBe(1000);
        expect(model.boxes[0]?.top).toBe(120);

        expect(model.labels).toHaveLength(1);
        expect(model.labels[0]?.text).toBe('Pivot High');

        expect(model.tables).toHaveLength(1);
        expect(model.tables[0]?.cells).toHaveLength(1);
        expect(model.tables[0]?.cells[0]).toHaveLength(2);
        expect(model.tables[0]?.cells[0]?.[1]?.text).toBe('68.5');
    });

    it('merges multi-lot FIFO trades of the same fill order into a single execution', () => {
        // Strategy executes an exit order closing two FIFO lots at same bar/time
        const trades: PineTrade[] = [
            {
                id: 'lot_1',
                entry_id: 'Long_Entry',
                entry_price: 100,
                entry_time: 1000,
                entry_comment: 'Enter Long',
                exit_id: 'TP_Order',
                exit_price: 110,
                exit_time: 5000,
                exit_comment: 'Take Profit',
                size: 2,
                status: 'closed',
            },
            {
                id: 'lot_2',
                entry_id: 'Long_Entry_2',
                entry_price: 102,
                entry_time: 2000,
                entry_comment: 'Enter Long 2',
                exit_id: 'TP_Order',
                exit_price: 110,
                exit_time: 5000,
                exit_comment: 'Take Profit', // Same exit fill!
                size: 3,
                status: 'closed',
            },
        ];

        const executions = SceneTranslator.tradesToExecutions(trades);
        expect(executions).toHaveLength(3); // 2 distinct entries + 1 merged exit

        const entries = executions.filter((e) => e.kind === 'entry');
        expect(entries).toHaveLength(2);
        expect(entries[0]?.qty).toBe(2);
        expect(entries[1]?.qty).toBe(3);

        const exits = executions.filter((e) => e.kind === 'exit');
        expect(exits).toHaveLength(1);
        const exit = exits[0]!;
        expect(exit.time).toBe(5000);
        expect(exit.price).toBe(110);
        expect(exit.side).toBe('sell');
        expect(exit.qty).toBe(5); // 2 + 3 combined!
        expect(exit.label).toBe('Take Profit');
    });

    it('handles short orders, open trades, and reversal executions', () => {
        const trades: PineTrade[] = [
            {
                id: 't_short',
                entry_id: 'Short_1',
                entry_price: 150,
                entry_time: 1000,
                entry_comment: 'Go Short',
                size: -5, // Short
                status: 'open',
            },
        ];

        const executions = SceneTranslator.tradesToExecutions(trades);
        expect(executions).toHaveLength(1);
        expect(executions[0]?.side).toBe('sell');
        expect(executions[0]?.kind).toBe('entry');
        expect(executions[0]?.qty).toBe(5);
        expect(executions[0]?.price).toBe(150);
        expect(executions[0]?.label).toBe('Go Short');
    });
});

describe('VelaChartAdapter — Dynamic Pane Routing', () => {
    it('routes overlay indicators to price pane and oscillators to subpanes', () => {
        const adapter = new VelaChartAdapter();

        const overlayRun: PineRun = {
            meta: { title: 'Supertrend', overlay: true },
            plots: [
                {
                    key: 'st_plot',
                    title: 'ST',
                    style: 'line',
                    options: {},
                    data: [{ time: 1000, value: 100 }],
                },
            ],
        };

        const oscRun: PineRun = {
            meta: { title: 'RSI', overlay: false },
            plots: [
                {
                    key: 'rsi_plot',
                    title: 'RSI',
                    style: 'line',
                    options: {},
                    data: [{ time: 1000, value: 50 }],
                },
            ],
        };

        const overlayModel = adapter.loadPineRun(overlayRun, 'overlay-ind');
        expect(overlayModel.series[0]?.paneId).toBe('price');

        const oscModel = adapter.loadPineRun(oscRun, 'osc-ind');
        expect(oscModel.series[0]?.paneId).toMatch(/^subpane_/);
        expect(oscModel.series[0]?.paneId).not.toBe('price');
    });

    it('routes series with force_overlay=true to price pane even when indicator is on subpane', () => {
        const adapter = new VelaChartAdapter();

        const hybridRun: PineRun = {
            meta: { title: 'Hybrid Study', overlay: false },
            plots: [
                {
                    key: 'sub_plot',
                    title: 'Oscillator',
                    style: 'line',
                    options: {},
                    data: [{ time: 1000, value: 20 }],
                },
                {
                    key: 'forced_plot',
                    title: 'Price EMA in Study',
                    style: 'line',
                    options: { force_overlay: true },
                    data: [{ time: 1000, value: 100 }],
                },
            ],
        };

        const hybridModel = adapter.loadPineRun(hybridRun, 'hybrid-ind');
        const oscSeries = hybridModel.series.find((s) => s.title === 'Oscillator');
        const forcedSeries = hybridModel.series.find((s) => s.title === 'Price EMA in Study');

        expect(oscSeries?.paneId).toMatch(/^subpane_/);
        expect(forcedSeries?.paneId).toBe('price');
    });
    it('caches subpane IDs across repeated runs of the same indicator instance', () => {
        const adapter = new VelaChartAdapter();
        const oscRun: PineRun = {
            meta: { title: 'RSI', overlay: false },
            plots: [
                {
                    key: 'rsi_plot',
                    title: 'RSI',
                    style: 'line',
                    options: {},
                    data: [{ time: 1000, value: 50 }],
                },
            ],
        };

        const model1 = adapter.loadPineRun(oscRun, 'rsi-instance');
        const pane1 = model1.series[0]?.paneId;

        const model2 = adapter.loadPineRun(oscRun, 'rsi-instance');
        const pane2 = model2.series[0]?.paneId;

        expect(pane1).toBe(pane2);
    });
});

describe('SceneTranslator — Edge Cases & Integrity', () => {
    it('toOhlcBars does not produce sparse array holes when show_last is configured', () => {
        const candleRun: PineRun = {
            meta: { title: 'Candles', overlay: true },
            plots: [
                {
                    key: 'p_candle',
                    style: 'candle',
                    options: { show_last: 2 },
                    data: [
                        { time: 1000, value: [100, 105, 95, 102] },
                        { time: 2000, value: [102, 108, 100, 107] },
                        { time: 3000, value: [107, 110, 104, 109] },
                        { time: 4000, value: [109, 115, 108, 112] },
                    ],
                },
            ],
        };

        const { model } = toScene(candleRun, 'ind-candles');
        const candleSeries = model.series[0] as import('@luxalgo/vela/plugin').CandleSeries;
        expect(candleSeries.bars).toHaveLength(2);
        expect(candleSeries.bars[0]).toBeDefined();
        expect(candleSeries.bars[0]?.time).toBe(3000);
        expect(candleSeries.bars[1]?.time).toBe(4000);
        expect(Object.keys(candleSeries.bars)).toHaveLength(2);
    });

    it('retains all constituent tradeIds in merged FIFO trade executions for cross-probing', () => {
        const trades: PineTrade[] = [
            { id: 'lot_A', entry_id: 'E1', entry_price: 100, entry_time: 1000, exit_price: 110, exit_time: 5000, exit_comment: 'TP', size: 1, status: 'closed' },
            { id: 'lot_B', entry_id: 'E2', entry_price: 102, entry_time: 2000, exit_price: 110, exit_time: 5000, exit_comment: 'TP', size: 2, status: 'closed' },
        ];

        const executions = SceneTranslator.tradesToExecutions(trades);
        const exitExec = executions.find((e) => e.kind === 'exit') as import('../src/scene/SceneTranslator.js').MergedTradeExecution;
        expect(exitExec).toBeDefined();
        expect(exitExec.tradeIds).toContain('lot_A');
        expect(exitExec.tradeIds).toContain('lot_B');
    });
});

