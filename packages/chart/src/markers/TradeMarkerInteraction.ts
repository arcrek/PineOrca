import type { MarkerLayoutUnit, TradeMarkerLayer } from './TradeMarkerLayer.js';

export interface TradeTooltipData {
    tradeId?: string;
    label?: string;
    side: 'buy' | 'sell';
    kind: 'entry' | 'exit';
    price: number;
    qty?: number;
    time: number;
    title: string;
    details: Array<{ label: string; value: string }>;
}

export interface HoverTradeEvent {
    tradeId: string | null;
    unit: MarkerLayoutUnit | null;
    x: number;
    y: number;
    tooltip: TradeTooltipData | null;
}

export interface ClickTradeEvent {
    tradeId: string | null;
    unit: MarkerLayoutUnit;
    x: number;
    y: number;
}

export type HoverCallback = (event: HoverTradeEvent | null) => void;
export type ClickCallback = (event: ClickTradeEvent) => void;

export class TradeMarkerInteraction {
    private layer: TradeMarkerLayer;
    private targetElement: HTMLElement | null = null;
    private hoverListeners = new Set<HoverCallback>();
    private clickListeners = new Set<ClickCallback>();
    private hoveredUnit: MarkerLayoutUnit | null = null;
    private repaintCallback: (() => void) | null = null;

    private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private mouseLeaveHandler: ((e: MouseEvent) => void) | null = null;
    private clickHandler: ((e: MouseEvent) => void) | null = null;

    constructor(layer: TradeMarkerLayer, container?: HTMLElement) {
        this.layer = layer;
        if (container) {
            this.attach(container);
        }
    }

    attach(container: HTMLElement): void {
        this.detach();
        this.targetElement = container;

        this.mouseMoveHandler = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.handlePointerMove(x, y);
        };

        this.mouseLeaveHandler = () => {
            this.handlePointerLeave();
        };

        this.clickHandler = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.handlePointerClick(x, y);
        };

        container.addEventListener('mousemove', this.mouseMoveHandler);
        container.addEventListener('mouseleave', this.mouseLeaveHandler);
        container.addEventListener('click', this.clickHandler);
    }

    setRepaintCallback(cb: (() => void) | null): void {
        this.repaintCallback = cb;
    }

    detach(): void {
        if (!this.targetElement) return;

        if (this.mouseMoveHandler) {
            this.targetElement.removeEventListener('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
        if (this.mouseLeaveHandler) {
            this.targetElement.removeEventListener('mouseleave', this.mouseLeaveHandler);
            this.mouseLeaveHandler = null;
        }
        if (this.clickHandler) {
            this.targetElement.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
        this.targetElement = null;
    }

    onHover(cb: HoverCallback): () => void {
        this.hoverListeners.add(cb);
        return () => this.hoverListeners.delete(cb);
    }

    onClick(cb: ClickCallback): () => void {
        this.clickListeners.add(cb);
        return () => this.clickListeners.delete(cb);
    }

    /**
     * Hit-tests point (x, y) against marker bounding boxes.
     */
    hitTest(x: number, y: number): MarkerLayoutUnit | null {
        const layout = this.layer.getLayout();
        // Check in reverse so top-stacked/later-drawn items hit first
        for (let i = layout.length - 1; i >= 0; i -= 1) {
            const unit = layout[i]!;
            const { bounds } = unit;
            if (
                x >= bounds.x &&
                x <= bounds.x + bounds.width &&
                y >= bounds.y &&
                y <= bounds.y + bounds.height
            ) {
                return unit;
            }
        }
        return null;
    }

    /**
     * Programmatically simulate or handle pointer movement.
     */
    handlePointerMove(x: number, y: number): MarkerLayoutUnit | null {
        const hit = this.hitTest(x, y);

        if (hit) {
            if (this.hoveredUnit !== hit) {
                this.hoveredUnit = hit;
                const tradeId = hit.execution.tradeId ?? null;
                this.layer.setHighlightedTradeId(tradeId);
                const tooltip = this.createTooltipData(hit);

                const evt: HoverTradeEvent = {
                    tradeId,
                    unit: hit,
                    x,
                    y,
                    tooltip,
                };
                for (const listener of this.hoverListeners) {
                    listener(evt);
                }
                if (this.repaintCallback) this.repaintCallback();
            }
            return hit;
        }

        if (this.hoveredUnit !== null) {
            this.hoveredUnit = null;
            this.layer.setHighlightedTradeId(null);
            for (const listener of this.hoverListeners) {
                listener(null);
            }
            if (this.repaintCallback) this.repaintCallback();
        }
        return null;
    }

    handlePointerLeave(): void {
        if (this.hoveredUnit !== null) {
            this.hoveredUnit = null;
            this.layer.setHighlightedTradeId(null);
            for (const listener of this.hoverListeners) {
                listener(null);
            }
            if (this.repaintCallback) this.repaintCallback();
        }
    }

    handlePointerClick(x: number, y: number): MarkerLayoutUnit | null {
        const hit = this.hitTest(x, y);
        if (hit) {
            const tradeId = hit.execution.tradeId ?? null;
            this.layer.setSelectedTradeId(tradeId);
            const evt: ClickTradeEvent = {
                tradeId,
                unit: hit,
                x,
                y,
            };
            for (const listener of this.clickListeners) {
                listener(evt);
            }
            if (this.repaintCallback) this.repaintCallback();
            return hit;
        }
        return null;
    }

    createTooltipData(unit: MarkerLayoutUnit): TradeTooltipData {
        const { execution, side, kind } = unit;
        const sideStr = side === 'buy' ? 'Buy' : 'Sell';
        const kindStr = kind === 'entry' ? 'Entry' : 'Exit';
        const title = `${sideStr} ${kindStr} ${execution.label ? `(${execution.label})` : ''}`.trim();

        const details: Array<{ label: string; value: string }> = [
            { label: 'Price', value: execution.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) },
        ];

        if (execution.qty != null && Number.isFinite(execution.qty)) {
            const sign = side === 'buy' ? '+' : '-';
            details.push({ label: 'Quantity', value: `${sign}${formatQty(execution.qty)}` });
        }

        if (execution.tradeId) {
            details.push({ label: 'Trade ID', value: execution.tradeId });
        }

        const date = new Date(execution.time);
        details.push({ label: 'Time', value: date.toISOString().replace('T', ' ').replace(/\..+/, '') });

        return {
            tradeId: execution.tradeId,
            label: execution.label,
            side,
            kind,
            price: execution.price,
            qty: execution.qty,
            time: execution.time,
            title,
            details,
        };
    }

    highlightTrade(tradeId: string | null): void {
        this.layer.setHighlightedTradeId(tradeId);
    }

    selectTrade(tradeId: string | null): void {
        this.layer.setSelectedTradeId(tradeId);
    }
}
function formatQty(qty: number): string {
    const trimmed = Number(qty.toFixed(4));
    return String(trimmed);
}
