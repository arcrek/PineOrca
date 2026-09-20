import type { TradeExecution } from '@luxalgo/vela/plugin';

export interface TradeMarkerDeps {
    timeToLogical(ms: number): number;
    logicalToX(logical: number): number;
    priceToY(price: number): number;
    barAt(logical: number): { high: number; low: number; open?: number; close?: number } | null;
    barBodyHalfWidth?: number;
}

export interface TradeMarkerStyleConfig {
    fontSize?: number;
    fontFamily?: string;
    textColor?: string;
    longColor?: string;
    shortColor?: string;
    exitColor?: string;
    highlightGlowColor?: string;
}

export interface TradeMarkerDisplayOptions {
    visible?: boolean;
    labels?: boolean;
    qty?: boolean;
    ticks?: boolean;
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface MarkerLayoutUnit {
    execution: TradeExecution;
    logical: number;
    time: number;
    x: number;
    tipY: number;
    arrowY: number;
    side: 'buy' | 'sell';
    kind: 'entry' | 'exit';
    color: string;
    lines: string[];
    bounds: BoundingBox;
    tick?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };
    highlighted?: boolean;
    selected?: boolean;
}

export const BAR_GAP = 10;
export const ARROW_W = 9;
export const HEAD_H = 6;
export const ARROW_H = 14;
export const STEM_W = 3;
export const CAP_H = 2;
export const CAP_GAP = 2;
export const TEXT_GAP = 3;
export const UNIT_GAP = 6;
export const TICK_W = 6;
export const TICK_H = 8;

export const DEFAULT_LONG_COLOR = '#22ab94';
export const DEFAULT_SHORT_COLOR = '#f23645';
export const DEFAULT_EXIT_COLOR = '#d500f9';
export const DEFAULT_TEXT_COLOR = '#d1d4dc';

export class TradeMarkerLayer {
    private trades: readonly TradeExecution[] = [];
    private displayOpts: Required<TradeMarkerDisplayOptions> = {
        visible: true,
        labels: true,
        qty: true,
        ticks: true,
    };
    private styleConfig: Required<TradeMarkerStyleConfig> = {
        fontSize: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textColor: DEFAULT_TEXT_COLOR,
        longColor: DEFAULT_LONG_COLOR,
        shortColor: DEFAULT_SHORT_COLOR,
        exitColor: DEFAULT_EXIT_COLOR,
        highlightGlowColor: '#2962ff',
    };
    private highlightedTradeId: string | null = null;
    private selectedTradeId: string | null = null;
    private currentLayout: MarkerLayoutUnit[] = [];

    constructor(
        options?: TradeMarkerDisplayOptions,
        style?: TradeMarkerStyleConfig,
    ) {
        if (options) this.setDisplayOptions(options);
        if (style) this.setStyle(style);
    }

    setTrades(trades: readonly TradeExecution[]): void {
        this.trades = trades;
    }

    setDisplayOptions(opts: TradeMarkerDisplayOptions): void {
        this.displayOpts = { ...this.displayOpts, ...opts };
    }

    setStyle(style: TradeMarkerStyleConfig): void {
        this.styleConfig = { ...this.styleConfig, ...style };
    }

    setHighlightedTradeId(tradeId: string | null): void {
        this.highlightedTradeId = tradeId;
        for (const item of this.currentLayout) {
            item.highlighted = Boolean(tradeId && this.matchesTrade(item.execution, tradeId));
        }
    }

    setSelectedTradeId(tradeId: string | null): void {
        this.selectedTradeId = tradeId;
        for (const item of this.currentLayout) {
            item.selected = Boolean(tradeId && this.matchesTrade(item.execution, tradeId));
        }
    }

    private matchesTrade(exec: TradeExecution, tradeId: string): boolean {
        if (exec.tradeId === tradeId) return true;
        const merged = exec as { tradeIds?: string[] };
        return Boolean(merged.tradeIds && merged.tradeIds.includes(tradeId));
    }

    getLayout(): readonly MarkerLayoutUnit[] {
        return this.currentLayout;
    }

    /**
     * Computes the layout and bounding boxes of all visible trade markers,
     * stacking same-bar orders outward to avoid visual collision.
     */
    computeLayout(deps: TradeMarkerDeps): MarkerLayoutUnit[] {
        if (!this.displayOpts.visible || this.trades.length === 0) {
            this.currentLayout = [];
            return [];
        }

        const lineH = this.styleConfig.fontSize + 4;
        const byBar = new Map<number, { buys: TradeExecution[]; sells: TradeExecution[] }>();

        for (const trade of this.trades) {
            const logical = Math.round(deps.timeToLogical(trade.time));
            let stack = byBar.get(logical);
            if (!stack) {
                stack = { buys: [], sells: [] };
                byBar.set(logical, stack);
            }
            if (trade.side === 'buy') {
                stack.buys.push(trade);
            } else {
                stack.sells.push(trade);
            }
        }

        const units: MarkerLayoutUnit[] = [];
        const halfBarW = deps.barBodyHalfWidth ?? 4;

        for (const [logical, { buys, sells }] of byBar.entries()) {
            const bar = deps.barAt(logical);
            if (!bar) continue;

            const x = deps.logicalToX(logical);
            const highY = deps.priceToY(bar.high);
            const lowY = deps.priceToY(bar.low);

            // Buys stack downwards below candle low (tip at the top pointing UP)
            let currentLowOffset = BAR_GAP;
            for (const exec of buys) {
                const color = exec.kind === 'exit' ? this.styleConfig.exitColor : this.styleConfig.longColor;
                const lines = this.resolveTextLines(exec);
                const textBlockH = lines.length ? TEXT_GAP + lines.length * lineH : 0;
                const unitH = ARROW_H + textBlockH;

                const tipY = lowY + currentLowOffset;
                const arrowY = tipY;
                const boundsY = tipY;
                const maxTextW = this.estimateTextWidth(lines);
                const unitW = Math.max(ARROW_W + 4, maxTextW + 8);
                const bounds: BoundingBox = {
                    x: x - unitW / 2,
                    y: boundsY,
                    width: unitW,
                    height: unitH,
                };

                const tickY = deps.priceToY(exec.price);
                const tick = this.displayOpts.ticks
                    ? {
                          x1: x - halfBarW,
                          y1: tickY,
                          x2: x - halfBarW - TICK_W,
                          y2: tickY,
                      }
                    : undefined;

                units.push({
                    execution: exec,
                    logical,
                    time: exec.time,
                    x,
                    tipY,
                    arrowY,
                    side: 'buy',
                    kind: exec.kind,
                    color,
                    lines,
                    bounds,
                    tick,
                    highlighted: Boolean(this.highlightedTradeId && exec.tradeId === this.highlightedTradeId),
                    selected: Boolean(this.selectedTradeId && exec.tradeId === this.selectedTradeId),
                });

                currentLowOffset += unitH + UNIT_GAP;
            }

            // Sells stack upwards above candle high (tip at the bottom pointing DOWN)
            let currentHighOffset = BAR_GAP;
            for (const exec of sells) {
                const color = exec.kind === 'exit' ? this.styleConfig.exitColor : this.styleConfig.shortColor;
                const lines = this.resolveTextLines(exec);
                const textBlockH = lines.length ? TEXT_GAP + lines.length * lineH : 0;
                const unitH = ARROW_H + textBlockH;

                const tipY = highY - currentHighOffset;
                const arrowY = tipY - ARROW_H;
                const boundsY = tipY - unitH;
                const maxTextW = this.estimateTextWidth(lines);
                const unitW = Math.max(ARROW_W + 4, maxTextW + 8);
                const bounds: BoundingBox = {
                    x: x - unitW / 2,
                    y: boundsY,
                    width: unitW,
                    height: unitH,
                };

                const tickY = deps.priceToY(exec.price);
                const tick = this.displayOpts.ticks
                    ? {
                          x1: x + halfBarW,
                          y1: tickY,
                          x2: x + halfBarW + TICK_W,
                          y2: tickY,
                      }
                    : undefined;

                units.push({
                    execution: exec,
                    logical,
                    time: exec.time,
                    x,
                    tipY,
                    arrowY,
                    side: 'sell',
                    kind: exec.kind,
                    color,
                    lines,
                    bounds,
                    tick,
                    highlighted: Boolean(this.highlightedTradeId && exec.tradeId === this.highlightedTradeId),
                    selected: Boolean(this.selectedTradeId && exec.tradeId === this.selectedTradeId),
                });

                currentHighOffset += unitH + UNIT_GAP;
            }
        }

        this.currentLayout = units;
        return units;
    }

    /**
     * Renders markers onto a 2D canvas context.
     */
    render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.displayOpts.visible || this.currentLayout.length === 0) return;

        ctx.save();
        ctx.font = `${this.styleConfig.fontSize}px ${this.styleConfig.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lineH = this.styleConfig.fontSize + 4;

        for (const unit of this.currentLayout) {
            // Cull offscreen
            if (
                unit.bounds.x + unit.bounds.width < 0 ||
                unit.bounds.x > width ||
                unit.bounds.y + unit.bounds.height < 0 ||
                unit.bounds.y > height
            ) {
                continue;
            }

            ctx.save();

            // Highlight / Selection glow
            if (unit.highlighted || unit.selected) {
                ctx.strokeStyle = unit.selected ? '#ffeb3b' : this.styleConfig.highlightGlowColor;
                ctx.lineWidth = unit.selected ? 2 : 1.5;
                ctx.strokeRect(unit.bounds.x - 2, unit.bounds.y - 2, unit.bounds.width + 4, unit.bounds.height + 4);
            }

            // Draw arrow
            this.drawArrow(ctx, unit);

            // Draw tick
            if (unit.tick) {
                ctx.strokeStyle = unit.color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(unit.tick.x1, unit.tick.y1);
                ctx.lineTo(unit.tick.x2, unit.tick.y2);
                ctx.stroke();
            }

            // Draw text lines
            if (unit.lines.length > 0) {
                ctx.fillStyle = this.styleConfig.textColor;
                let textY: number;

                if (unit.side === 'buy') {
                    // Lines flow downwards below arrow
                    textY = unit.arrowY + ARROW_H + TEXT_GAP + lineH / 2;
                    for (const line of unit.lines) {
                        ctx.fillText(line, unit.x, textY);
                        textY += lineH;
                    }
                } else {
                    // Lines flow upwards above arrow (reversed order so outer is outermost)
                    textY = unit.arrowY - TEXT_GAP - lineH / 2;
                    for (let i = 0; i < unit.lines.length; i += 1) {
                        ctx.fillText(unit.lines[i]!, unit.x, textY);
                        textY -= lineH;
                    }
                }
            }

            ctx.restore();
        }

        ctx.restore();
    }

    private drawArrow(ctx: CanvasRenderingContext2D, unit: MarkerLayoutUnit): void {
        const { x, side, kind, color } = unit;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;

        if (side === 'buy') {
            // Points UP (tip at unit.tipY, stem below)
            const tipY = unit.tipY;
            const headBaseY = tipY + HEAD_H;
            const stemBottomY = tipY + ARROW_H;

            // Exit cap: transverse bar between tip and candle
            if (kind === 'exit') {
                ctx.lineWidth = CAP_H;
                ctx.beginPath();
                ctx.moveTo(x - ARROW_W / 2, tipY - CAP_GAP);
                ctx.lineTo(x + ARROW_W / 2, tipY - CAP_GAP);
                ctx.stroke();
            }

            // Arrow head & stem
            ctx.beginPath();
            ctx.moveTo(x, tipY);
            ctx.lineTo(x + ARROW_W / 2, headBaseY);
            ctx.lineTo(x + STEM_W / 2, headBaseY);
            ctx.lineTo(x + STEM_W / 2, stemBottomY);
            ctx.lineTo(x - STEM_W / 2, stemBottomY);
            ctx.lineTo(x - STEM_W / 2, headBaseY);
            ctx.lineTo(x - ARROW_W / 2, headBaseY);
            ctx.closePath();
            ctx.fill();
        } else {
            // Points DOWN (tip at unit.tipY, stem above)
            const tipY = unit.tipY;
            const headBaseY = tipY - HEAD_H;
            const stemTopY = tipY - ARROW_H;

            // Exit cap: transverse bar between tip and candle
            if (kind === 'exit') {
                ctx.lineWidth = CAP_H;
                ctx.beginPath();
                ctx.moveTo(x - ARROW_W / 2, tipY + CAP_GAP);
                ctx.lineTo(x + ARROW_W / 2, tipY + CAP_GAP);
                ctx.stroke();
            }

            // Arrow head & stem
            ctx.beginPath();
            ctx.moveTo(x, tipY);
            ctx.lineTo(x + ARROW_W / 2, headBaseY);
            ctx.lineTo(x + STEM_W / 2, headBaseY);
            ctx.lineTo(x + STEM_W / 2, stemTopY);
            ctx.lineTo(x - STEM_W / 2, stemTopY);
            ctx.lineTo(x - STEM_W / 2, headBaseY);
            ctx.lineTo(x - ARROW_W / 2, headBaseY);
            ctx.closePath();
            ctx.fill();
        }
    }

    private resolveTextLines(exec: TradeExecution): string[] {
        const lines: string[] = [];
        if (this.displayOpts.labels && exec.label) {
            lines.push(exec.label);
        }
        if (this.displayOpts.qty && exec.qty != null && Number.isFinite(exec.qty)) {
            const sign = exec.side === 'buy' ? '+' : '-';
            const qtyStr = `${sign}${formatQty(exec.qty)}`;
            lines.push(qtyStr);
        }
        return lines;
    }

    private estimateTextWidth(lines: string[]): number {
        if (lines.length === 0) return 0;
        let maxLen = 0;
        for (const line of lines) {
            if (line.length > maxLen) maxLen = line.length;
        }
        return maxLen * (this.styleConfig.fontSize * 0.62);
    }
}

function formatQty(qty: number): string {
    const trimmed = Number(qty.toFixed(4));
    return String(trimmed);
}
