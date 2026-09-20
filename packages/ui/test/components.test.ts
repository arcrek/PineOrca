// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDOM, type MockHTMLElement } from './setup-dom.js';
import { BottomDock } from '../src/dock/BottomDock.js';
import { OverviewTab } from '../src/tester/tabs/OverviewTab.js';
import { PerformanceSummaryTab } from '../src/tester/tabs/PerformanceSummaryTab.js';
import { StrategyTester } from '../src/tester/StrategyTester.js';
import {
    MonacoPineEditor,
    registerPineLanguage,
    PINE_LANGUAGE_ID,
    PINE_MONARCH_TOKENS_PROVIDER,
    PINE_LANGUAGE_CONFIGURATION,
} from '../src/editor/MonacoPineEditor.js';

describe('UI Components — Lifecycle, Rendering, and Interactions', () => {
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

    describe('BottomDock', () => {
        it('initializes in split mode and transitions through states', () => {
            const dock = new BottomDock({ initialHeight: 320 });
            let lastState: string | null = null;
            let lastHeight: number | null = null;

            dock.onStateChange((s) => {
                lastState = s;
            });
            dock.onHeightChange((h) => {
                lastHeight = h;
            });

            dock.mount(container as unknown as HTMLElement);

            expect(dock.getState()).toBe('split');
            expect(dock.getHeight()).toBe(320);

            // Transition to collapsed
            dock.setState('collapsed');
            expect(dock.getState()).toBe('collapsed');
            expect(lastState).toBe('collapsed');

            const root = dock.getRootElement() as unknown as MockHTMLElement;
            expect(root?.style.height).toBe(`${BottomDock.COLLAPSED_HEIGHT}px`);

            // Transition to maximized
            dock.setState('maximized');
            expect(dock.getState()).toBe('maximized');
            expect(lastState).toBe('maximized');
            expect(root?.style.height).toBe('100%');

            // Set height in split mode
            dock.setState('split');
            dock.setHeight(400);
            expect(dock.getHeight()).toBe(400);
            expect(lastHeight).toBe(400);

            // Summary pills update
            dock.updateSummary({
                netProfit: 1250.5,
                netProfitPercent: 12.5,
                winRate: 58.2,
                profitFactor: 1.85,
                openPositions: 2,
            });

            dock.destroy();
        });

        it('switches tabs and mounts tab content', () => {
            const dock = new BottomDock();
            dock.mount(container as unknown as HTMLElement);

            let changedTab = '';
            dock.onTabChange((t) => {
                changedTab = t;
            });

            const customContent = document.createElement('div');
            customContent.className = 'test-content';
            dock.setTabContent('tester', customContent);

            dock.setActiveTab('editor');
            expect(dock.getActiveTab()).toBe('editor');
            expect(changedTab).toBe('editor');

            dock.destroy();
        });
    });

    describe('OverviewTab', () => {
        it('renders KPI cards and chart canvases with data updates', () => {
            const overview = new OverviewTab();
            overview.mount(container as unknown as HTMLElement);

            overview.update(
                {
                    netProfit: 3500,
                    netProfitPercent: 35.0,
                    profitFactor: 2.1,
                    winRate: 62.5,
                    maxDrawdown: 450,
                    maxDrawdownPercent: 4.5,
                    totalTrades: 80,
                },
                [
                    { time: 1000, equity: 10000, buyAndHold: 10000, drawdownPercent: 0 },
                    { time: 2000, equity: 11000, buyAndHold: 10500, drawdownPercent: 0 },
                    { time: 3000, equity: 10500, buyAndHold: 10200, drawdownPercent: -4.5 },
                    { time: 4000, equity: 13500, buyAndHold: 11000, drawdownPercent: 0 },
                ]
            );

            expect(overview.getElement()).not.toBeNull();
            overview.resize(900, 350);

            overview.destroy();
        });
    });

    describe('PerformanceSummaryTab', () => {
        it('updates financial metric rows and renders categories', () => {
            const summary = new PerformanceSummaryTab();
            summary.mount(container as unknown as HTMLElement);

            summary.update({
                netProfit: { all: 5200, long: 3800, short: 1400 },
                profitFactor: { all: 2.4, long: 2.8, short: 1.7 },
                totalClosedTrades: { all: 150, long: 90, short: 60 },
                percentProfitable: { all: 60.0, long: 63.3, short: 55.0 },
                sharpeRatio: { all: 1.85 },
            });

            expect(summary.getElement()).not.toBeNull();
            summary.destroy();
        });
    });

    describe('StrategyTester', () => {
        it('switches between subtabs and dispatches data to child tabs', () => {
            const tester = new StrategyTester();
            tester.mount(container as unknown as HTMLElement);

            expect(tester.getActiveSubTab()).toBe('overview');

            let switchedTo = '';
            tester.onSubTabChange((t) => {
                switchedTo = t;
            });

            tester.setActiveSubTab('summary');
            expect(tester.getActiveSubTab()).toBe('summary');
            expect(switchedTo).toBe('summary');

            tester.setActiveSubTab('trades');
            expect(tester.getActiveSubTab()).toBe('trades');
            expect(switchedTo).toBe('trades');

            tester.setResults({
                overviewMetrics: { netProfit: 1000 },
                performanceSummary: { netProfit: { all: 1000 } },
                trades: [],
            });

            tester.destroy();
        });
    });

    describe('MonacoPineEditor', () => {
        it('registers Pine language grammar and tokens in Monaco runtime', () => {
            const registeredLangs: Array<{ id: string }> = [];
            const mockMonaco = {
                languages: {
                    getLanguages: () => registeredLangs,
                    register: vi.fn((lang) => registeredLangs.push(lang)),
                    setMonarchTokensProvider: vi.fn(),
                    setLanguageConfiguration: vi.fn(),
                },
                editor: {
                    create: vi.fn(() => ({
                        getValue: () => '//@version=5\nindicator("Test")',
                        setValue: vi.fn(),
                        getModel: () => ({}),
                        dispose: vi.fn(),
                        addCommand: vi.fn(),
                    })),
                    setModelMarkers: vi.fn(),
                },
                MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
            };

            registerPineLanguage(mockMonaco);
            expect(mockMonaco.languages.register).toHaveBeenCalledWith({
                id: PINE_LANGUAGE_ID,
                extensions: ['.pine', '.ps'],
            });
            expect(mockMonaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
                PINE_LANGUAGE_ID,
                PINE_MONARCH_TOKENS_PROVIDER
            );
            expect(mockMonaco.languages.setLanguageConfiguration).toHaveBeenCalledWith(
                PINE_LANGUAGE_ID,
                PINE_LANGUAGE_CONFIGURATION
            );

            // Re-registration should no-op
            registerPineLanguage(mockMonaco);
            expect(mockMonaco.languages.register).toHaveBeenCalledTimes(1);
        });

        it('dispatches actions and manages diagnostics squiggles', () => {
            const editor = new MonacoPineEditor({
                initialCode: '//@version=5\nstrategy("Test")',
            });
            editor.mount(container as unknown as HTMLElement);

            let executedAction: string | null = null;
            let executedCode: string | null = null;

            editor.onAction((action, code) => {
                executedAction = action;
                executedCode = code;
            });

            editor.triggerAction('updateStrategy');
            expect(executedAction).toBe('updateStrategy');
            expect(executedCode).toContain('//@version=5');

            editor.setValue('//@version=5\nstrategy("Updated")');
            expect(editor.getValue()).toBe('//@version=5\nstrategy("Updated")');

            // Diagnostics
            editor.setDiagnostics([
                {
                    line: 2,
                    column: 5,
                    message: 'Syntax error: unexpected token',
                    severity: 'error',
                },
            ]);
            expect(editor.getDiagnostics()).toHaveLength(1);

            editor.destroy();
        });
    });
});
