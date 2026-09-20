// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export type DockState = 'collapsed' | 'split' | 'maximized';

export interface DockSummaryData {
    netProfit?: number;
    netProfitPercent?: number;
    winRate?: number;
    openPositions?: number;
    profitFactor?: number;
    symbol?: string;
    currency?: string;
}

export interface BottomDockOptions {
    initialState?: DockState;
    initialHeight?: number;
    minHeight?: number;
    maxHeight?: number;
    initialTab?: string;
}

export type StateChangeCallback = (state: DockState) => void;
export type HeightChangeCallback = (height: number) => void;
export type TabChangeCallback = (tabId: string) => void;

/**
 * 3-state dockable container: collapsed, split, maximized with drag resizer.
 * Supports TradingView-style docking below the chart.
 */
export class BottomDock {
    private state: DockState;
    private height: number;
    private minHeight: number;
    private maxHeight: number;
    private activeTab: string;
    private summary: DockSummaryData = {};

    private container: HTMLElement | null = null;
    private rootElement: HTMLElement | null = null;
    private resizerElement: HTMLElement | null = null;
    private headerElement: HTMLElement | null = null;
    private tabBarElement: HTMLElement | null = null;
    private summaryPillElement: HTMLElement | null = null;
    private controlsElement: HTMLElement | null = null;
    private bodyElement: HTMLElement | null = null;

    private tabs = new Map<string, { label: string; element: HTMLElement | null }>();
    private stateListeners = new Set<StateChangeCallback>();
    private heightListeners = new Set<HeightChangeCallback>();
    private tabListeners = new Set<TabChangeCallback>();

    private isDragging = false;
    private startDragY = 0;
    private startDragHeight = 0;
    private boundOnMouseMove: ((e: MouseEvent) => void) | null = null;
    private boundOnMouseUp: ((e: MouseEvent) => void) | null = null;

    public static readonly COLLAPSED_HEIGHT = 36;
    public static readonly DEFAULT_SPLIT_HEIGHT = 340;

    constructor(options: BottomDockOptions = {}) {
        this.state = options.initialState ?? 'split';
        this.height = options.initialHeight ?? BottomDock.DEFAULT_SPLIT_HEIGHT;
        this.minHeight = options.minHeight ?? 120;
        this.maxHeight = options.maxHeight ?? 1200;
        this.activeTab = options.initialTab ?? 'tester';

        // Register default tabs
        this.tabs.set('tester', { label: 'Strategy Tester', element: null });
        this.tabs.set('editor', { label: 'Pine Editor', element: null });
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.buildDOM();
        this.applyState();
    }

    destroy(): void {
        this.removeDragListeners();
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
        this.rootElement = null;
        this.resizerElement = null;
        this.headerElement = null;
        this.tabBarElement = null;
        this.summaryPillElement = null;
        this.controlsElement = null;
        this.bodyElement = null;
        this.container = null;
        this.stateListeners.clear();
        this.heightListeners.clear();
        this.tabListeners.clear();
    }

    getState(): DockState {
        return this.state;
    }

    setState(state: DockState): void {
        if (this.state === state) return;
        this.state = state;
        this.applyState();
        for (const listener of this.stateListeners) {
            listener(state);
        }
    }

    getHeight(): number {
        return this.height;
    }

    setHeight(height: number): void {
        const clamped = Math.max(this.minHeight, Math.min(this.maxHeight, height));
        if (this.height === clamped) return;
        this.height = clamped;
        if (this.state === 'split') {
            this.applyHeight();
        }
        for (const listener of this.heightListeners) {
            listener(this.height);
        }
    }

    getActiveTab(): string {
        return this.activeTab;
    }

    setActiveTab(tabId: string): void {
        if (this.activeTab === tabId && this.state !== 'collapsed') return;
        this.activeTab = tabId;
        if (this.state === 'collapsed') {
            this.setState('split');
        }
        this.renderTabs();
        this.renderActiveContent();
        for (const listener of this.tabListeners) {
            listener(tabId);
        }
    }

    setTabContent(tabId: string, element: HTMLElement): void {
        const tab = this.tabs.get(tabId);
        if (tab) {
            tab.element = element;
        } else {
            this.tabs.set(tabId, { label: tabId, element });
        }
        if (this.activeTab === tabId) {
            this.renderActiveContent();
        }
    }

    registerTab(tabId: string, label: string, element?: HTMLElement): void {
        this.tabs.set(tabId, { label, element: element ?? null });
        this.renderTabs();
    }

    updateSummary(summary: Partial<DockSummaryData>): void {
        this.summary = { ...this.summary, ...summary };
        this.renderSummaryPills();
    }

    onStateChange(cb: StateChangeCallback): () => void {
        this.stateListeners.add(cb);
        return () => this.stateListeners.delete(cb);
    }

    onHeightChange(cb: HeightChangeCallback): () => void {
        this.heightListeners.add(cb);
        return () => this.heightListeners.delete(cb);
    }

    onTabChange(cb: TabChangeCallback): () => void {
        this.tabListeners.add(cb);
        return () => this.tabListeners.delete(cb);
    }

    getRootElement(): HTMLElement | null {
        return this.rootElement;
    }

    getBodyElement(): HTMLElement | null {
        return this.bodyElement;
    }

    private buildDOM(): void {
        if (typeof document === 'undefined' || !this.container) return;

        const root = document.createElement('div');
        root.className = 'pineorca-bottom-dock';
        root.style.boxSizing = 'border-box';
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.backgroundColor = '#131722';
        root.style.color = '#d1d4dc';
        root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif';
        root.style.fontSize = '13px';
        root.style.overflow = 'hidden';
        root.style.borderTop = '1px solid #2a2e39';
        root.style.position = 'relative';
        root.style.width = '100%';
        this.rootElement = root;

        // 1. Resizer handle
        const resizer = document.createElement('div');
        resizer.className = 'pineorca-dock-resizer';
        resizer.style.height = '4px';
        resizer.style.width = '100%';
        resizer.style.cursor = 'ns-resize';
        resizer.style.position = 'absolute';
        resizer.style.top = '0';
        resizer.style.left = '0';
        resizer.style.zIndex = '10';
        resizer.style.backgroundColor = 'transparent';
        resizer.addEventListener('mousedown', (e) => this.onMouseDownResizer(e));
        this.resizerElement = resizer;
        root.appendChild(resizer);

        // 2. Header
        const header = document.createElement('div');
        header.className = 'pineorca-dock-header';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.height = `${BottomDock.COLLAPSED_HEIGHT}px`;
        header.style.minHeight = `${BottomDock.COLLAPSED_HEIGHT}px`;
        header.style.padding = '0 8px';
        header.style.backgroundColor = '#1e222d';
        header.style.borderBottom = '1px solid #2a2e39';
        header.style.userSelect = 'none';
        this.headerElement = header;
        root.appendChild(header);

        // Header Left: Tab Bar
        const tabBar = document.createElement('div');
        tabBar.className = 'pineorca-dock-tabs';
        tabBar.style.display = 'flex';
        tabBar.style.alignItems = 'center';
        tabBar.style.gap = '4px';
        this.tabBarElement = tabBar;
        header.appendChild(tabBar);

        // Header Center: Summary Pills
        const summaryPill = document.createElement('div');
        summaryPill.className = 'pineorca-dock-summary';
        summaryPill.style.display = 'flex';
        summaryPill.style.alignItems = 'center';
        summaryPill.style.gap = '12px';
        summaryPill.style.fontSize = '12px';
        this.summaryPillElement = summaryPill;
        header.appendChild(summaryPill);

        // Header Right: Controls
        const controls = document.createElement('div');
        controls.className = 'pineorca-dock-controls';
        controls.style.display = 'flex';
        controls.style.alignItems = 'center';
        controls.style.gap = '4px';
        this.controlsElement = controls;
        header.appendChild(controls);

        this.buildControls();

        // 3. Body
        const body = document.createElement('div');
        body.className = 'pineorca-dock-body';
        body.style.flex = '1';
        body.style.overflow = 'hidden';
        body.style.position = 'relative';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        this.bodyElement = body;
        root.appendChild(body);

        this.container.appendChild(root);

        this.renderTabs();
        this.renderSummaryPills();
        this.renderActiveContent();
    }

    private buildControls(): void {
        if (!this.controlsElement) return;
        this.controlsElement.innerHTML = '';

        const createButton = (title: string, iconText: string, onClick: () => void) => {
            const btn = document.createElement('button');
            btn.title = title;
            btn.innerHTML = iconText;
            btn.style.background = 'transparent';
            btn.style.border = 'none';
            btn.style.color = '#787b86';
            btn.style.cursor = 'pointer';
            btn.style.padding = '4px 6px';
            btn.style.borderRadius = '4px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.fontSize = '14px';
            btn.style.lineHeight = '1';
            btn.addEventListener('mouseenter', () => {
                btn.style.color = '#d1d4dc';
                btn.style.backgroundColor = '#2a2e39';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.color = '#787b86';
                btn.style.backgroundColor = 'transparent';
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                onClick();
            });
            return btn;
        };

        // Collapse / Expand toggle button
        const toggleBtn = createButton(
            this.state === 'collapsed' ? 'Restore dock' : 'Collapse dock',
            this.state === 'collapsed' ? '▲' : '▼',
            () => {
                if (this.state === 'collapsed') {
                    this.setState('split');
                } else {
                    this.setState('collapsed');
                }
            }
        );
        this.controlsElement.appendChild(toggleBtn);

        // Maximize / Split toggle button
        const maxBtn = createButton(
            this.state === 'maximized' ? 'Restore window size' : 'Maximize dock',
            this.state === 'maximized' ? '🗗' : '🗖',
            () => {
                if (this.state === 'maximized') {
                    this.setState('split');
                } else {
                    this.setState('maximized');
                }
            }
        );
        this.controlsElement.appendChild(maxBtn);
    }

    private renderTabs(): void {
        if (!this.tabBarElement) return;
        this.tabBarElement.innerHTML = '';

        for (const [id, tab] of this.tabs.entries()) {
            const tabBtn = document.createElement('button');
            tabBtn.className = `pineorca-dock-tab ${id === this.activeTab ? 'active' : ''}`;
            tabBtn.textContent = tab.label;
            tabBtn.style.background = 'transparent';
            tabBtn.style.border = 'none';
            tabBtn.style.cursor = 'pointer';
            tabBtn.style.padding = '6px 12px';
            tabBtn.style.borderRadius = '4px';
            tabBtn.style.fontSize = '13px';
            tabBtn.style.fontWeight = id === this.activeTab ? '600' : '400';
            tabBtn.style.color = id === this.activeTab ? '#2962ff' : '#787b86';
            tabBtn.style.borderBottom = id === this.activeTab ? '2px solid #2962ff' : '2px solid transparent';

            tabBtn.addEventListener('click', () => {
                this.setActiveTab(id);
            });
            this.tabBarElement.appendChild(tabBtn);
        }
    }

    private renderSummaryPills(): void {
        if (!this.summaryPillElement) return;
        this.summaryPillElement.innerHTML = '';

        // Only show summary pills in collapsed state or split state
        const netProfit = this.summary.netProfit ?? 0;
        const netProfitPct = this.summary.netProfitPercent ?? 0;
        const winRate = this.summary.winRate ?? 0;
        const openPos = this.summary.openPositions ?? 0;
        const profitFactor = this.summary.profitFactor ?? 0;

        const formatCurrency = (val: number) => {
            const sign = val >= 0 ? '+' : '';
            return `${sign}$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const createPill = (label: string, value: string, color: string) => {
            const pill = document.createElement('div');
            pill.style.display = 'inline-flex';
            pill.style.alignItems = 'center';
            pill.style.gap = '6px';
            pill.style.padding = '2px 8px';
            pill.style.borderRadius = '12px';
            pill.style.backgroundColor = '#2a2e39';

            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.color = '#787b86';
            lbl.style.fontSize = '11px';

            const val = document.createElement('span');
            val.textContent = value;
            val.style.color = color;
            val.style.fontWeight = '600';
            val.style.fontSize = '12px';

            pill.appendChild(lbl);
            pill.appendChild(val);
            return pill;
        };

        const pnlColor = netProfit > 0 ? '#089981' : netProfit < 0 ? '#f23645' : '#787b86';
        const pnlText = `${formatCurrency(netProfit)} (${netProfitPct >= 0 ? '+' : ''}${netProfitPct.toFixed(2)}%)`;
        this.summaryPillElement.appendChild(createPill('Net P&L', pnlText, pnlColor));

        const winRateColor = winRate >= 50 ? '#089981' : '#787b86';
        this.summaryPillElement.appendChild(createPill('Win Rate', `${winRate.toFixed(1)}%`, winRateColor));

        if (profitFactor > 0) {
            this.summaryPillElement.appendChild(createPill('Profit Factor', profitFactor.toFixed(2), '#d1d4dc'));
        }

        const posColor = openPos !== 0 ? '#2962ff' : '#787b86';
        this.summaryPillElement.appendChild(createPill('Open Positions', `${openPos}`, posColor));
    }

    private renderActiveContent(): void {
        if (!this.bodyElement) return;
        this.bodyElement.innerHTML = '';
        const currentTab = this.tabs.get(this.activeTab);
        if (currentTab && currentTab.element) {
            currentTab.element.style.width = '100%';
            currentTab.element.style.height = '100%';
            this.bodyElement.appendChild(currentTab.element);
        }
    }

    private applyState(): void {
        if (!this.rootElement) return;

        this.buildControls();

        if (this.state === 'collapsed') {
            this.rootElement.style.height = `${BottomDock.COLLAPSED_HEIGHT}px`;
            if (this.bodyElement) this.bodyElement.style.display = 'none';
            if (this.resizerElement) this.resizerElement.style.display = 'none';
        } else if (this.state === 'split') {
            this.applyHeight();
            if (this.bodyElement) this.bodyElement.style.display = 'flex';
            if (this.resizerElement) this.resizerElement.style.display = 'block';
        } else if (this.state === 'maximized') {
            this.rootElement.style.height = '100%';
            if (this.bodyElement) this.bodyElement.style.display = 'flex';
            if (this.resizerElement) this.resizerElement.style.display = 'none';
        }
    }

    private applyHeight(): void {
        if (!this.rootElement) return;
        this.rootElement.style.height = `${this.height}px`;
    }

    private onMouseDownResizer(e: MouseEvent): void {
        if (this.state !== 'split') return;
        e.preventDefault();
        this.isDragging = true;
        this.startDragY = e.clientY;
        this.startDragHeight = this.height;

        this.boundOnMouseMove = (evt: MouseEvent) => this.onMouseMoveResizer(evt);
        this.boundOnMouseUp = () => this.onMouseUpResizer();

        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', this.boundOnMouseMove);
            window.addEventListener('mouseup', this.boundOnMouseUp);
        }
    }

    private onMouseMoveResizer(e: MouseEvent): void {
        if (!this.isDragging) return;
        // Dragging upward increases height; dragging downward decreases height
        const deltaY = this.startDragY - e.clientY;
        this.setHeight(this.startDragHeight + deltaY);
    }

    private onMouseUpResizer(): void {
        this.isDragging = false;
        this.removeDragListeners();
    }

    private removeDragListeners(): void {
        if (typeof window !== 'undefined') {
            if (this.boundOnMouseMove) {
                window.removeEventListener('mousemove', this.boundOnMouseMove);
                this.boundOnMouseMove = null;
            }
            if (this.boundOnMouseUp) {
                window.removeEventListener('mouseup', this.boundOnMouseUp);
                this.boundOnMouseUp = null;
            }
        }
    }
}
