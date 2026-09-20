// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export interface PerformanceMetricValue {
    all: number | string | null;
    long?: number | string | null;
    short?: number | string | null;
    format?: 'currency' | 'percent' | 'number' | 'ratio' | 'text';
    subAll?: string;
    subLong?: string;
    subShort?: string;
}

export interface PerformanceSummaryRecord {
    category: string;
    label: string;
    key: string;
    data: PerformanceMetricValue;
}

/**
 * 3-column financial table comparing All, Long, Short trades across 30+ metrics.
 * Designed to mirror TradingView's high-density Strategy Tester summary.
 */
export class PerformanceSummaryTab {
    private container: HTMLElement | null = null;
    private rootElement: HTMLElement | null = null;
    private tableBodyElement: HTMLElement | null = null;
    private metrics: Map<string, PerformanceSummaryRecord> = new Map();

    constructor() {
        this.initDefaultMetrics();
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.buildDOM();
        this.renderTable();
    }

    destroy(): void {
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
        this.rootElement = null;
        this.tableBodyElement = null;
        this.container = null;
        this.metrics.clear();
    }

    update(partialMetrics: Record<string, Partial<PerformanceMetricValue>>): void {
        for (const [key, val] of Object.entries(partialMetrics)) {
            const existing = this.metrics.get(key);
            if (existing) {
                existing.data = { ...existing.data, ...val };
            }
        }
        this.renderTable();
    }

    setMetric(key: string, data: PerformanceMetricValue): void {
        const existing = this.metrics.get(key);
        if (existing) {
            existing.data = data;
            this.renderTable();
        }
    }

    getElement(): HTMLElement | null {
        return this.rootElement;
    }

    private initDefaultMetrics(): void {
        const add = (category: string, label: string, key: string, format: PerformanceMetricValue['format']) => {
            this.metrics.set(key, {
                category,
                label,
                key,
                data: { all: 0, long: 0, short: 0, format },
            });
        };

        // PnL & Performance
        add('Capital & PnL', 'Net Profit', 'netProfit', 'currency');
        add('Capital & PnL', 'Gross Profit', 'grossProfit', 'currency');
        add('Capital & PnL', 'Gross Loss', 'grossLoss', 'currency');
        add('Capital & PnL', 'Profit Factor', 'profitFactor', 'ratio');
        add('Capital & PnL', 'Expected Payoff', 'expectancy', 'currency');
        add('Capital & PnL', 'Max Drawdown', 'maxDrawdown', 'currency');
        add('Capital & PnL', 'Max Run-up', 'maxRunup', 'currency');
        add('Capital & PnL', 'Open Profit', 'openProfit', 'currency');
        add('Capital & PnL', 'Commission Paid', 'commissionPaid', 'currency');

        // Trade Counts & Win Rate
        add('Trades Analysis', 'Total Closed Trades', 'totalClosedTrades', 'number');
        add('Trades Analysis', 'Winning Trades', 'winningTrades', 'number');
        add('Trades Analysis', 'Losing Trades', 'losingTrades', 'number');
        add('Trades Analysis', 'Even Trades', 'evenTrades', 'number');
        add('Trades Analysis', 'Percent Profitable (Win Rate)', 'percentProfitable', 'percent');

        // Trade Averages & Extremes
        add('Trade Averages', 'Avg Trade', 'avgTrade', 'currency');
        add('Trade Averages', 'Avg Winning Trade', 'avgWinningTrade', 'currency');
        add('Trade Averages', 'Avg Losing Trade', 'avgLosingTrade', 'currency');
        add('Trade Averages', 'Ratio Avg Win / Avg Loss', 'ratioAvgWinAvgLoss', 'ratio');
        add('Trade Averages', 'Largest Winning Trade', 'largestWinningTrade', 'currency');
        add('Trade Averages', 'Largest Losing Trade', 'largestLosingTrade', 'currency');

        // Streaks & Exposure
        add('Streaks & Risk', 'Max Consecutive Winning Trades', 'maxConsecutiveWins', 'number');
        add('Streaks & Risk', 'Max Consecutive Losing Trades', 'maxConsecutiveLosses', 'number');
        add('Streaks & Risk', 'Sharpe Ratio', 'sharpeRatio', 'ratio');
        add('Streaks & Risk', 'Sortino Ratio', 'sortinoRatio', 'ratio');
        add('Streaks & Risk', 'CAGR', 'cagr', 'percent');
        add('Streaks & Risk', 'Buy & Hold Return', 'buyAndHoldReturn', 'currency');
        add('Streaks & Risk', 'Strategy Outperformance', 'strategyOutperformance', 'currency');
        add('Streaks & Risk', 'Max Contracts Held', 'maxContractsHeld', 'number');
        add('Streaks & Risk', 'Margin Calls', 'marginCalls', 'number');

        // Duration & Bars
        add('Trade Durations', 'Total Bars in Trades', 'totalBarsInTrades', 'number');
        add('Trade Durations', 'Avg Bars in Trades', 'avgBarsInTrades', 'number');
        add('Trade Durations', 'Avg Bars in Winning Trades', 'avgBarsInWinningTrades', 'number');
        add('Trade Durations', 'Avg Bars in Losing Trades', 'avgBarsInLosingTrades', 'number');
    }

    private buildDOM(): void {
        if (typeof document === 'undefined' || !this.container) return;

        const root = document.createElement('div');
        root.className = 'pineorca-tester-summary';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.overflowY = 'auto';
        root.style.backgroundColor = '#131722';
        root.style.color = '#d1d4dc';
        root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        root.style.fontSize = '12px';
        root.style.boxSizing = 'border-box';
        root.style.padding = '8px 16px';
        this.rootElement = root;

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.textAlign = 'left';

        // Table Header
        const thead = document.createElement('thead');
        thead.style.position = 'sticky';
        thead.style.top = '0';
        thead.style.backgroundColor = '#1e222d';
        thead.style.zIndex = '2';

        const headerRow = document.createElement('tr');
        headerRow.style.borderBottom = '1px solid #2a2e39';

        const thMetric = document.createElement('th');
        thMetric.textContent = 'Performance Metric';
        thMetric.style.padding = '8px 12px';
        thMetric.style.color = '#787b86';
        thMetric.style.fontWeight = '600';
        thMetric.style.width = '40%';
        headerRow.appendChild(thMetric);

        const thAll = document.createElement('th');
        thAll.textContent = 'All Trades';
        thAll.style.padding = '8px 12px';
        thAll.style.color = '#787b86';
        thAll.style.fontWeight = '600';
        thAll.style.textAlign = 'right';
        thAll.style.width = '20%';
        headerRow.appendChild(thAll);

        const thLong = document.createElement('th');
        thLong.textContent = 'Long Trades';
        thLong.style.padding = '8px 12px';
        thLong.style.color = '#787b86';
        thLong.style.fontWeight = '600';
        thLong.style.textAlign = 'right';
        thLong.style.width = '20%';
        headerRow.appendChild(thLong);

        const thShort = document.createElement('th');
        thShort.textContent = 'Short Trades';
        thShort.style.padding = '8px 12px';
        thShort.style.color = '#787b86';
        thShort.style.fontWeight = '600';
        thShort.style.textAlign = 'right';
        thShort.style.width = '20%';
        headerRow.appendChild(thShort);

        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        this.tableBodyElement = tbody;
        table.appendChild(tbody);

        root.appendChild(table);
        this.container.appendChild(root);
    }

    private renderTable(): void {
        if (!this.tableBodyElement) return;
        this.tableBodyElement.innerHTML = '';

        let currentCategory = '';

        for (const record of this.metrics.values()) {
            if (record.category !== currentCategory) {
                currentCategory = record.category;
                const catRow = document.createElement('tr');
                catRow.style.backgroundColor = '#181b24';
                catRow.style.borderTop = '1px solid #2a2e39';
                catRow.style.borderBottom = '1px solid #2a2e39';

                const catTd = document.createElement('td');
                catTd.colSpan = 4;
                catTd.textContent = currentCategory.toUpperCase();
                catTd.style.padding = '6px 12px';
                catTd.style.fontSize = '11px';
                catTd.style.fontWeight = '700';
                catTd.style.color = '#2962ff';
                catTd.style.letterSpacing = '0.5px';

                catRow.appendChild(catTd);
                this.tableBodyElement.appendChild(catRow);
            }

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #1e222d';
            tr.addEventListener('mouseenter', () => {
                tr.style.backgroundColor = '#1e222d';
            });
            tr.addEventListener('mouseleave', () => {
                tr.style.backgroundColor = 'transparent';
            });

            // Label
            const tdLabel = document.createElement('td');
            tdLabel.textContent = record.label;
            tdLabel.style.padding = '6px 12px';
            tdLabel.style.color = '#d1d4dc';
            tr.appendChild(tdLabel);

            // Helper to format values
            const formatVal = (v: number | string | null | undefined, format: PerformanceMetricValue['format']) => {
                if (v == null || v === 'N/A') return '—';
                if (typeof v === 'string') return v;
                if (!Number.isFinite(v)) return '—';
                switch (format) {
                    case 'currency': {
                        const sign = v > 0 ? '+' : '';
                        return `${sign}$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    }
                    case 'percent': {
                        const sign = v > 0 ? '+' : '';
                        return `${sign}${v.toFixed(2)}%`;
                    }
                    case 'ratio':
                        return v.toFixed(2);
                    case 'number':
                        return v.toLocaleString();
                    default:
                        return String(v);
                }
            };

            const getColor = (v: number | string | null | undefined, format: PerformanceMetricValue['format']) => {
                if (typeof v !== 'number' || !Number.isFinite(v)) return '#d1d4dc';
                if (format === 'currency' || format === 'percent') {
                    if (v > 0) return '#089981';
                    if (v < 0) return '#f23645';
                }
                return '#d1d4dc';
            };

            // All Trades
            const tdAll = document.createElement('td');
            tdAll.style.padding = '6px 12px';
            tdAll.style.textAlign = 'right';
            tdAll.textContent = formatVal(record.data.all, record.data.format);
            tdAll.style.color = getColor(record.data.all, record.data.format);
            if (record.data.subAll) {
                tdAll.innerHTML += `<div style="font-size:10px;color:#787b86;">${record.data.subAll}</div>`;
            }
            tr.appendChild(tdAll);

            // Long Trades
            const tdLong = document.createElement('td');
            tdLong.style.padding = '6px 12px';
            tdLong.style.textAlign = 'right';
            tdLong.textContent = formatVal(record.data.long, record.data.format);
            tdLong.style.color = getColor(record.data.long, record.data.format);
            if (record.data.subLong) {
                tdLong.innerHTML += `<div style="font-size:10px;color:#787b86;">${record.data.subLong}</div>`;
            }
            tr.appendChild(tdLong);

            // Short Trades
            const tdShort = document.createElement('td');
            tdShort.style.padding = '6px 12px';
            tdShort.style.textAlign = 'right';
            tdShort.textContent = formatVal(record.data.short, record.data.format);
            tdShort.style.color = getColor(record.data.short, record.data.format);
            if (record.data.subShort) {
                tdShort.innerHTML += `<div style="font-size:10px;color:#787b86;">${record.data.subShort}</div>`;
            }
            tr.appendChild(tdShort);

            this.tableBodyElement.appendChild(tr);
        }
    }
}
