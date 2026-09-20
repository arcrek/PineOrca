// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { OverviewTab, type EquityPoint, type OverviewMetrics } from './tabs/OverviewTab.js';
import { PerformanceSummaryTab, type PerformanceMetricValue } from './tabs/PerformanceSummaryTab.js';
import { ListOfTradesTab, type TradeRowItem } from './tabs/ListOfTradesTab.js';

export type TesterSubTab = 'overview' | 'summary' | 'trades';

export interface StrategyTesterData {
    overviewMetrics?: Partial<OverviewMetrics>;
    equityCurve?: EquityPoint[];
    performanceSummary?: Record<string, Partial<PerformanceMetricValue>>;
    trades?: TradeRowItem[];
}

export type TesterTabChangeCallback = (tab: TesterSubTab) => void;

/**
 * Main tabbed container orchestrating Strategy Tester views:
 * Overview, Performance Summary, and Virtualized List of Trades.
 */
export class StrategyTester {
    private container: HTMLElement | null = null;
    private rootElement: HTMLElement | null = null;
    private navElement: HTMLElement | null = null;
    private contentElement: HTMLElement | null = null;

    private activeSubTab: TesterSubTab = 'overview';
    private overviewTab: OverviewTab;
    private summaryTab: PerformanceSummaryTab;
    private tradesTab: ListOfTradesTab;

    private tabListeners = new Set<TesterTabChangeCallback>();

    constructor() {
        this.overviewTab = new OverviewTab();
        this.summaryTab = new PerformanceSummaryTab();
        this.tradesTab = new ListOfTradesTab();
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.buildDOM();
        this.renderActiveTab();
    }

    destroy(): void {
        this.overviewTab.destroy();
        this.summaryTab.destroy();
        this.tradesTab.destroy();

        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
        this.rootElement = null;
        this.navElement = null;
        this.contentElement = null;
        this.container = null;
        this.tabListeners.clear();
    }

    setResults(data: StrategyTesterData): void {
        if (data.overviewMetrics || data.equityCurve) {
            this.overviewTab.update(data.overviewMetrics, data.equityCurve);
        }
        if (data.performanceSummary) {
            this.summaryTab.update(data.performanceSummary);
        }
        if (data.trades) {
            this.tradesTab.setTrades(data.trades);
        }
    }

    setActiveSubTab(tab: TesterSubTab): void {
        if (this.activeSubTab === tab) return;
        this.activeSubTab = tab;
        this.renderNav();
        this.renderActiveTab();
        for (const listener of this.tabListeners) {
            listener(tab);
        }
    }

    getActiveSubTab(): TesterSubTab {
        return this.activeSubTab;
    }

    getOverviewTab(): OverviewTab {
        return this.overviewTab;
    }

    getPerformanceSummaryTab(): PerformanceSummaryTab {
        return this.summaryTab;
    }

    getListOfTradesTab(): ListOfTradesTab {
        return this.tradesTab;
    }

    getElement(): HTMLElement | null {
        return this.rootElement;
    }

    onSubTabChange(cb: TesterTabChangeCallback): () => void {
        this.tabListeners.add(cb);
        return () => this.tabListeners.delete(cb);
    }

    private buildDOM(): void {
        if (typeof document === 'undefined' || !this.container) return;

        const root = document.createElement('div');
        root.className = 'pineorca-strategy-tester';
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.backgroundColor = '#131722';
        root.style.color = '#d1d4dc';
        root.style.overflow = 'hidden';
        root.style.boxSizing = 'border-box';
        this.rootElement = root;

        // Sub-navigation bar
        const nav = document.createElement('div');
        nav.className = 'pineorca-tester-nav';
        nav.style.display = 'flex';
        nav.style.alignItems = 'center';
        nav.style.gap = '8px';
        nav.style.padding = '4px 12px';
        nav.style.backgroundColor = '#181b24';
        nav.style.borderBottom = '1px solid #2a2e39';
        nav.style.userSelect = 'none';
        this.navElement = nav;
        root.appendChild(nav);

        // Content container
        const content = document.createElement('div');
        content.className = 'pineorca-tester-content';
        content.style.flex = '1';
        content.style.position = 'relative';
        content.style.overflow = 'hidden';
        content.style.display = 'flex';
        content.style.flexDirection = 'column';
        this.contentElement = content;
        root.appendChild(content);

        this.renderNav();
        this.container.appendChild(root);
    }

    private renderNav(): void {
        if (!this.navElement) return;
        this.navElement.innerHTML = '';

        const tabs: Array<{ id: TesterSubTab; label: string }> = [
            { id: 'overview', label: 'Overview' },
            { id: 'summary', label: 'Performance Summary' },
            { id: 'trades', label: 'List of Trades' },
        ];

        for (const t of tabs) {
            const btn = document.createElement('button');
            btn.className = `pineorca-tester-subtab ${this.activeSubTab === t.id ? 'active' : ''}`;
            btn.textContent = t.label;
            btn.style.background = 'transparent';
            btn.style.border = 'none';
            btn.style.cursor = 'pointer';
            btn.style.padding = '4px 10px';
            btn.style.borderRadius = '4px';
            btn.style.fontSize = '12px';
            btn.style.fontWeight = this.activeSubTab === t.id ? '600' : '400';
            btn.style.color = this.activeSubTab === t.id ? '#2962ff' : '#787b86';
            btn.style.backgroundColor = this.activeSubTab === t.id ? 'rgba(41, 98, 255, 0.1)' : 'transparent';

            btn.addEventListener('mouseenter', () => {
                if (this.activeSubTab !== t.id) {
                    btn.style.color = '#d1d4dc';
                    btn.style.backgroundColor = '#2a2e39';
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (this.activeSubTab !== t.id) {
                    btn.style.color = '#787b86';
                    btn.style.backgroundColor = 'transparent';
                }
            });
            btn.addEventListener('click', () => {
                this.setActiveSubTab(t.id);
            });
            this.navElement.appendChild(btn);
        }
    }

    private renderActiveTab(): void {
        if (!this.contentElement) return;
        this.contentElement.innerHTML = '';

        if (this.activeSubTab === 'overview') {
            this.overviewTab.mount(this.contentElement);
        } else if (this.activeSubTab === 'summary') {
            this.summaryTab.mount(this.contentElement);
        } else if (this.activeSubTab === 'trades') {
            this.tradesTab.mount(this.contentElement);
        }
    }
}
