// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export interface TradeRowItem {
    tradeId: string;
    tradeIndex: number;
    type: 'Entry Long' | 'Exit Long' | 'Entry Short' | 'Exit Short';
    side: 'buy' | 'sell';
    kind: 'entry' | 'exit';
    signal: string;
    time: number;
    price: number;
    contracts: number;
    profit?: number;
    profitPercent?: number;
    cumulativePnl?: number;
    runup?: number;
    runupPercent?: number;
    drawdown?: number;
    drawdownPercent?: number;
    barIndex?: number;
}

export type RowClickCallback = (row: TradeRowItem) => void;
export type RowHoverCallback = (row: TradeRowItem | null) => void;

export interface VirtualDataGridOptions {
    rowHeight?: number;
    overscan?: number;
    onRowClick?: RowClickCallback;
    onRowHover?: RowHoverCallback;
}

/**
 * High-performance virtualized grid with constant-size DOM element pool recycling.
 * Designed to render 50,000+ trade rows at 60 FPS with zero memory leaks.
 */
export class VirtualDataGrid {
    private rows: TradeRowItem[] = [];
    private rowHeight: number;
    private overscan: number;
    private viewportHeight = 400;
    private scrollTop = 0;

    private container: HTMLElement | null = null;
    private viewportElement: HTMLElement | null = null;
    private spacerElement: HTMLElement | null = null;
    private domPool: HTMLElement[] = [];
    private poolSize = 0;

    private selectedTradeId: string | null = null;
    private highlightedTradeId: string | null = null;

    private clickListeners = new Set<RowClickCallback>();
    private hoverListeners = new Set<RowHoverCallback>();

    private boundScrollHandler: (() => void) | null = null;
    private rafId: number | null = null;

    constructor(options: VirtualDataGridOptions = {}) {
        this.rowHeight = options.rowHeight ?? 28;
        this.overscan = options.overscan ?? 5;
        if (options.onRowClick) this.clickListeners.add(options.onRowClick);
        if (options.onRowHover) this.hoverListeners.add(options.onRowHover);
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.buildDOM();
        this.recalculatePoolSize();
        this.render();
    }

    destroy(): void {
        if (this.viewportElement && this.boundScrollHandler) {
            this.viewportElement.removeEventListener('scroll', this.boundScrollHandler);
            this.boundScrollHandler = null;
        }
        if (this.rafId != null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.viewportElement && this.viewportElement.parentNode) {
            this.viewportElement.parentNode.removeChild(this.viewportElement);
        }
        this.viewportElement = null;
        this.spacerElement = null;
        this.domPool = [];
        this.container = null;
        this.clickListeners.clear();
        this.hoverListeners.clear();
    }

    setRows(rows: TradeRowItem[]): void {
        this.rows = rows;
        this.updateSpacer();
        this.render();
    }

    getRows(): readonly TradeRowItem[] {
        return this.rows;
    }

    setViewportHeight(height: number): void {
        if (this.viewportHeight === height) return;
        this.viewportHeight = height;
        this.recalculatePoolSize();
        this.render();
    }

    selectTrade(tradeId: string | null): void {
        this.selectedTradeId = tradeId;
        this.render();
    }

    getSelectedTradeId(): string | null {
        return this.selectedTradeId;
    }

    highlightTrade(tradeId: string | null): void {
        if (this.highlightedTradeId === tradeId) return;
        this.highlightedTradeId = tradeId;
        this.render();
    }

    getHighlightedTradeId(): string | null {
        return this.highlightedTradeId;
    }

    scrollToTrade(tradeId: string): void {
        const idx = this.rows.findIndex((r) => r.tradeId === tradeId);
        if (idx !== -1 && this.viewportElement) {
            const targetScrollTop = Math.max(0, idx * this.rowHeight - this.viewportHeight / 2);
            this.viewportElement.scrollTop = targetScrollTop;
            this.scrollTop = targetScrollTop;
            this.render();
        }
    }

    onRowClick(cb: RowClickCallback): () => void {
        this.clickListeners.add(cb);
        return () => this.clickListeners.delete(cb);
    }

    onRowHover(cb: RowHoverCallback): () => void {
        this.hoverListeners.add(cb);
        return () => this.hoverListeners.delete(cb);
    }

    /**
     * Number of physical DOM rows currently allocated in the recycled pool.
     */
    getPoolElementCount(): number {
        return this.domPool.length;
    }

    getViewportElement(): HTMLElement | null {
        return this.viewportElement;
    }

    private buildDOM(): void {
        if (typeof document === 'undefined' || !this.container) return;

        const viewport = document.createElement('div');
        viewport.className = 'pineorca-virtual-grid-viewport';
        viewport.style.width = '100%';
        viewport.style.height = '100%';
        viewport.style.overflowY = 'auto';
        viewport.style.position = 'relative';
        viewport.style.boxSizing = 'border-box';
        viewport.style.backgroundColor = '#131722';
        this.viewportElement = viewport;

        const spacer = document.createElement('div');
        spacer.className = 'pineorca-virtual-grid-spacer';
        spacer.style.width = '100%';
        spacer.style.position = 'relative';
        spacer.style.pointerEvents = 'none';
        this.spacerElement = spacer;
        viewport.appendChild(spacer);

        this.boundScrollHandler = () => {
            this.scrollTop = this.viewportElement ? this.viewportElement.scrollTop : 0;
            if (this.rafId == null) {
                if (typeof requestAnimationFrame !== 'undefined') {
                    this.rafId = requestAnimationFrame(() => {
                        this.rafId = null;
                        this.render();
                    });
                } else {
                    this.render();
                }
            }
        };
        viewport.addEventListener('scroll', this.boundScrollHandler);

        this.container.appendChild(viewport);
    }

    private updateSpacer(): void {
        if (this.spacerElement) {
            this.spacerElement.style.height = `${this.rows.length * this.rowHeight}px`;
        }
    }

    private recalculatePoolSize(): void {
        if (typeof document === 'undefined' || !this.viewportElement) return;

        const needed = Math.ceil(this.viewportHeight / this.rowHeight) + 2 * this.overscan + 2;
        if (needed <= this.domPool.length) return;

        const toAdd = needed - this.domPool.length;
        for (let i = 0; i < toAdd; i++) {
            const rowEl = document.createElement('div');
            rowEl.className = 'pineorca-grid-row';
            rowEl.style.position = 'absolute';
            rowEl.style.left = '0';
            rowEl.style.width = '100%';
            rowEl.style.height = `${this.rowHeight}px`;
            rowEl.style.boxSizing = 'border-box';
            rowEl.style.display = 'flex';
            rowEl.style.alignItems = 'center';
            rowEl.style.borderBottom = '1px solid #1e222d';
            rowEl.style.fontSize = '12px';
            rowEl.style.color = '#d1d4dc';
            rowEl.style.cursor = 'pointer';
            rowEl.style.userSelect = 'none';
            rowEl.style.pointerEvents = 'auto';

            rowEl.addEventListener('click', () => {
                const idxStr = rowEl.getAttribute('data-row-index');
                if (idxStr != null) {
                    const idx = parseInt(idxStr, 10);
                    const row = this.rows[idx];
                    if (row) {
                        this.selectTrade(row.tradeId);
                        for (const listener of this.clickListeners) {
                            listener(row);
                        }
                    }
                }
            });

            rowEl.addEventListener('mouseenter', () => {
                const idxStr = rowEl.getAttribute('data-row-index');
                if (idxStr != null) {
                    const idx = parseInt(idxStr, 10);
                    const row = this.rows[idx] ?? null;
                    if (row) {
                        this.highlightTrade(row.tradeId);
                        for (const listener of this.hoverListeners) {
                            listener(row);
                        }
                    }
                }
            });

            rowEl.addEventListener('mouseleave', () => {
                this.highlightTrade(null);
                for (const listener of this.hoverListeners) {
                    listener(null);
                }
            });

            this.viewportElement.appendChild(rowEl);
            this.domPool.push(rowEl);
        }
        this.poolSize = this.domPool.length;
    }

    render(): void {
        if (!this.viewportElement || !this.domPool.length) return;

        const totalRows = this.rows.length;
        if (totalRows === 0) {
            for (const el of this.domPool) {
                el.style.display = 'none';
            }
            return;
        }

        const startIdx = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.overscan);
        const endIdx = Math.min(totalRows - 1, Math.ceil((this.scrollTop + this.viewportHeight) / this.rowHeight) + this.overscan);

        let poolIdx = 0;
        for (let rowIdx = startIdx; rowIdx <= endIdx && poolIdx < this.domPool.length; rowIdx++) {
            const rowItem = this.rows[rowIdx]!;
            const el = this.domPool[poolIdx]!;
            el.style.display = 'flex';
            el.style.transform = `translateY(${rowIdx * this.rowHeight}px)`;
            el.setAttribute('data-row-index', String(rowIdx));
            el.setAttribute('data-trade-id', rowItem.tradeId);

            // Row styling
            const isSelected = this.selectedTradeId === rowItem.tradeId;
            const isHighlighted = this.highlightedTradeId === rowItem.tradeId;

            if (isSelected) {
                el.style.backgroundColor = 'rgba(41, 98, 255, 0.2)';
                el.style.outline = '1px solid #2962ff';
            } else if (isHighlighted) {
                el.style.backgroundColor = '#1e222d';
                el.style.outline = 'none';
            } else {
                el.style.backgroundColor = rowIdx % 2 === 0 ? '#131722' : '#161a25';
                el.style.outline = 'none';
            }

            this.populateRowCells(el, rowItem);
            poolIdx++;
        }

        // Hide unused pool elements
        while (poolIdx < this.domPool.length) {
            this.domPool[poolIdx]!.style.display = 'none';
            poolIdx++;
        }
    }

    private populateRowCells(rowEl: HTMLElement, item: TradeRowItem): void {
        const dateStr = new Date(item.time).toLocaleDateString(undefined, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

        const isProfitPos = item.profit != null ? item.profit > 0 : null;
        const profitColor = isProfitPos === true ? '#089981' : isProfitPos === false ? '#f23645' : '#787b86';
        const typeColor = item.type.includes('Long') ? '#089981' : '#f23645';

        const formatCurr = (v?: number) => {
            if (v == null) return '—';
            const s = v >= 0 ? '+' : '';
            return `${s}$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const formatPct = (v?: number) => {
            if (v == null) return '';
            const s = v >= 0 ? '+' : '';
            return `(${s}${v.toFixed(2)}%)`;
        };

        rowEl.innerHTML = `
            <div style="width: 50px; padding: 0 8px; color: #787b86; text-align: right;">${item.tradeIndex}</div>
            <div style="width: 100px; padding: 0 8px; color: ${typeColor}; font-weight: 600;">${item.type}</div>
            <div style="width: 120px; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.signal || '—'}</div>
            <div style="width: 130px; padding: 0 8px; color: #787b86;">${dateStr}</div>
            <div style="width: 80px; padding: 0 8px; text-align: right;">$${item.price.toFixed(2)}</div>
            <div style="width: 70px; padding: 0 8px; text-align: right;">${item.contracts}</div>
            <div style="width: 130px; padding: 0 8px; text-align: right; color: ${profitColor};">
                ${formatCurr(item.profit)} <span style="font-size: 10px;">${formatPct(item.profitPercent)}</span>
            </div>
            <div style="width: 110px; padding: 0 8px; text-align: right;">${formatCurr(item.cumulativePnl)}</div>
            <div style="width: 90px; padding: 0 8px; text-align: right; color: #089981;">${item.runupPercent != null ? `+${item.runupPercent.toFixed(2)}%` : '—'}</div>
            <div style="width: 90px; padding: 0 8px; text-align: right; color: #f23645;">${item.drawdownPercent != null ? `${item.drawdownPercent.toFixed(2)}%` : '—'}</div>
        `;
    }
}

/**
 * List of Trades tab featuring the high-density virtualized table,
 * column headers, and CSV export functionality.
 */
export class ListOfTradesTab {
    private container: HTMLElement | null = null;
    private rootElement: HTMLElement | null = null;
    private grid: VirtualDataGrid;
    private headerElement: HTMLElement | null = null;
    private toolbarElement: HTMLElement | null = null;
    private rows: TradeRowItem[] = [];

    constructor(options: VirtualDataGridOptions = {}) {
        this.grid = new VirtualDataGrid(options);
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.buildDOM();
    }

    destroy(): void {
        this.grid.destroy();
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
        this.rootElement = null;
        this.headerElement = null;
        this.toolbarElement = null;
        this.container = null;
    }

    setTrades(trades: TradeRowItem[]): void {
        this.rows = trades;
        this.grid.setRows(trades);
    }

    getTrades(): readonly TradeRowItem[] {
        return this.rows;
    }

    getGrid(): VirtualDataGrid {
        return this.grid;
    }

    selectRow(tradeId: string | null): void {
        this.grid.selectTrade(tradeId);
    }

    highlightRow(tradeId: string | null): void {
        this.grid.highlightTrade(tradeId);
    }

    scrollToTrade(tradeId: string): void {
        this.grid.scrollToTrade(tradeId);
    }

    onRowClick(cb: RowClickCallback): () => void {
        return this.grid.onRowClick(cb);
    }

    onRowHover(cb: RowHoverCallback): () => void {
        return this.grid.onRowHover(cb);
    }

    exportCsv(): string {
        const headers = [
            'Trade #',
            'Type',
            'Signal',
            'Date/Time',
            'Price',
            'Contracts',
            'Profit ($)',
            'Profit (%)',
            'Cumulative PnL ($)',
            'Run-up (%)',
            'Drawdown (%)',
        ];

        const escape = (val: string | number | undefined | null) => {
            if (val == null) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const lines: string[] = [headers.join(',')];

        for (const r of this.rows) {
            const dateStr = new Date(r.time).toISOString();
            lines.push(
                [
                    escape(r.tradeIndex),
                    escape(r.type),
                    escape(r.signal),
                    escape(dateStr),
                    escape(r.price),
                    escape(r.contracts),
                    escape(r.profit),
                    escape(r.profitPercent),
                    escape(r.cumulativePnl),
                    escape(r.runupPercent),
                    escape(r.drawdownPercent),
                ].join(',')
            );
        }

        return lines.join('\n');
    }

    getElement(): HTMLElement | null {
        return this.rootElement;
    }

    private buildDOM(): void {
        if (typeof document === 'undefined' || !this.container) return;

        const root = document.createElement('div');
        root.className = 'pineorca-list-of-trades';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.backgroundColor = '#131722';
        root.style.boxSizing = 'border-box';
        root.style.overflow = 'hidden';
        this.rootElement = root;

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.alignItems = 'center';
        toolbar.style.justifyContent = 'space-between';
        toolbar.style.padding = '4px 8px';
        toolbar.style.backgroundColor = '#181b24';
        toolbar.style.borderBottom = '1px solid #2a2e39';
        this.toolbarElement = toolbar;

        const info = document.createElement('span');
        info.style.color = '#787b86';
        info.style.fontSize = '11px';
        info.textContent = `${this.rows.length} Total Executions`;
        toolbar.appendChild(info);

        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export CSV';
        exportBtn.style.backgroundColor = '#2a2e39';
        exportBtn.style.color = '#d1d4dc';
        exportBtn.style.border = '1px solid #363a45';
        exportBtn.style.borderRadius = '4px';
        exportBtn.style.padding = '3px 8px';
        exportBtn.style.fontSize = '11px';
        exportBtn.style.cursor = 'pointer';
        exportBtn.addEventListener('click', () => this.triggerCsvDownload());
        toolbar.appendChild(exportBtn);

        root.appendChild(toolbar);

        // Header Row
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.height = '26px';
        header.style.backgroundColor = '#1e222d';
        header.style.borderBottom = '1px solid #2a2e39';
        header.style.fontSize = '11px';
        header.style.fontWeight = '600';
        header.style.color = '#787b86';
        header.style.userSelect = 'none';
        header.style.flexShrink = '0';
        this.headerElement = header;

        header.innerHTML = `
            <div style="width: 50px; padding: 0 8px; text-align: right;">#</div>
            <div style="width: 100px; padding: 0 8px;">Type</div>
            <div style="width: 120px; padding: 0 8px;">Signal</div>
            <div style="width: 130px; padding: 0 8px;">Date/Time</div>
            <div style="width: 80px; padding: 0 8px; text-align: right;">Price</div>
            <div style="width: 70px; padding: 0 8px; text-align: right;">Size</div>
            <div style="width: 130px; padding: 0 8px; text-align: right;">Profit</div>
            <div style="width: 110px; padding: 0 8px; text-align: right;">Cum. PnL</div>
            <div style="width: 90px; padding: 0 8px; text-align: right;">Run-up</div>
            <div style="width: 90px; padding: 0 8px; text-align: right;">Drawdown</div>
        `;
        root.appendChild(header);

        // Grid Area
        const gridContainer = document.createElement('div');
        gridContainer.style.flex = '1';
        gridContainer.style.position = 'relative';
        gridContainer.style.overflow = 'hidden';
        root.appendChild(gridContainer);

        this.grid.mount(gridContainer);
        this.container.appendChild(root);
    }

    private triggerCsvDownload(): void {
        const csv = this.exportCsv();
        if (typeof document !== 'undefined' && document.createElement && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pineorca_trades_${Date.now()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }
}
