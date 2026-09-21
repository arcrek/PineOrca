import { Vela, type VelaOptions, type VelaTheme } from '@luxalgo/vela';
import type { IndicatorModel, TradeExecution } from '@luxalgo/vela/plugin';
import { SceneTranslator } from './scene/SceneTranslator.js';
import type { PineRun } from './scene/types.js';
import { TradeMarkerLayer, type TradeMarkerDeps, type TradeMarkerDisplayOptions, type TradeMarkerStyleConfig } from './markers/TradeMarkerLayer.js';
import { TradeMarkerInteraction, type HoverTradeEvent, type ClickTradeEvent } from './markers/TradeMarkerInteraction.js';

export interface VelaChartAdapterOptions {
    container?: HTMLElement;
    theme?: 'dark' | 'light' | Partial<VelaTheme>;
    symbol?: string;
    timeframe?: string;
    bars?: number;
    live?: boolean;
    tradeMarkers?: TradeMarkerDisplayOptions;
    markerStyle?: TradeMarkerStyleConfig;
}

export interface ResolvedPaneRouting {
    targetPaneId: string; // 'price' or dynamic subpane id
    seriesPaneMap: Map<string, string>; // seriesId -> targetPaneId
}

export class VelaChartAdapter {
    private vela: Vela | null = null;
    private container: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private markerLayer: TradeMarkerLayer;
    private markerInteraction: TradeMarkerInteraction;
    private markerCanvas: HTMLCanvasElement | null = null;
    private options: VelaChartAdapterOptions;
    private mountedIndicators = new Map<string, IndicatorModel>();
    private instanceSubpaneMap = new Map<string, string>();
    private paneCounter = 0;

    constructor(options: VelaChartAdapterOptions = {}) {
        this.options = options;
        this.markerLayer = new TradeMarkerLayer(options.tradeMarkers, options.markerStyle);
        this.markerInteraction = new TradeMarkerInteraction(this.markerLayer);

        if (options.container) {
            this.mount(options.container);
        }
    }

    getVelaInstance(): Vela | null {
        return this.vela;
    }

    getMarkerLayer(): TradeMarkerLayer {
        return this.markerLayer;
    }

    getMarkerInteraction(): TradeMarkerInteraction {
        return this.markerInteraction;
    }

    /**
     * Resolves CSS theme tokens from container/document:
     * --vela-surface, --vela-border, --vela-accent, --vela-text, etc.
     */
    resolveThemeTokens(el?: HTMLElement): VelaTheme {
        const root = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
        const style = root && typeof getComputedStyle !== 'undefined' ? getComputedStyle(root) : null;

        const isLight = this.options.theme === 'light';
        const defaultSurface = isLight ? '#ffffff' : '#131722';
        const defaultBorder = isLight ? '#e0e3eb' : '#2a2e39';
        const defaultText = isLight ? '#131722' : '#d1d4dc';

        const surface = style?.getPropertyValue('--vela-surface')?.trim() || defaultSurface;
        const border = style?.getPropertyValue('--vela-border')?.trim() || defaultBorder;
        const accent = style?.getPropertyValue('--vela-accent')?.trim() || '#2962ff';
        const text = style?.getPropertyValue('--vela-text')?.trim() || defaultText;
        const up = style?.getPropertyValue('--vela-up')?.trim() || '#22ab94';
        const down = style?.getPropertyValue('--vela-down')?.trim() || '#f23645';
        const font = style?.getPropertyValue('--vela-font')?.trim() || 'system-ui, -apple-system, sans-serif';
        const custom = typeof this.options.theme === 'object' ? this.options.theme : {};

        return {
            background: custom.background ?? surface,
            textColor: custom.textColor ?? text,
            gridColor: custom.gridColor ?? border,
            borderColor: custom.borderColor ?? border,
            upColor: custom.upColor ?? up,
            downColor: custom.downColor ?? down,
            fontFamily: custom.fontFamily ?? font,
        };
    }

    /**
     * Mounts the Vela chart instance to a DOM element.
     */
    mount(container: HTMLElement): void {
        if (this.container === container && this.vela) return;
        this.destroy();

        this.container = container;
        container.style.position = container.style.position || 'relative';

        const theme = this.resolveThemeTokens(container);
        const velaOpts: VelaOptions = {
            symbol: this.options.symbol,
            timeframe: this.options.timeframe,
            bars: this.options.bars,
            live: this.options.live,
            theme,
            nativeBackend: 'auto',
        };

        // Instantiate Vela
        try {
            this.vela = new Vela(container, velaOpts);
        } catch {
            // Vela may require window/canvas in test environments
            this.vela = null;
        }

        // Create overlay canvas for trade markers if DOM is present
        if (typeof document !== 'undefined' && document.createElement) {
            const canvas = document.createElement('canvas');
            canvas.className = 'pineorca-trade-marker-overlay';
            canvas.style.position = 'absolute';
            canvas.style.left = '0';
            canvas.style.top = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '5';
            container.appendChild(canvas);
            this.markerCanvas = canvas;
            this.markerInteraction.attach(container);
            this.markerInteraction.setRepaintCallback(() => this.requestMarkerRepaint());

            // Set up ResizeObserver
            if (typeof ResizeObserver !== 'undefined') {
                this.resizeObserver = new ResizeObserver((entries) => {
                    for (const entry of entries) {
                        const { width, height } = entry.contentRect;
                        this.handleResize(width, height);
                    }
                });
                this.resizeObserver.observe(container);
            }
        }
    }

    private handleResize(width: number, height: number): void {
        if (!this.markerCanvas) return;
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        this.markerCanvas.width = Math.round(width * dpr);
        this.markerCanvas.height = Math.round(height * dpr);
        const ctx = this.markerCanvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
            this.markerLayer.render(ctx, width, height);
        }
    }

    /**
     * Dynamic Pane Routing:
     * - Overlay indicators route to 'price'.
     * - Oscillators / study indicators route to 'new' subpanes.
     * - Individual series with `overlay: true` route to 'price' pane even if parent is unrouted or subpane.
     */
    routeIndicatorModel(model: IndicatorModel): ResolvedPaneRouting {
        const isOverlay = model.overlay || model.paneHint === 'price';
        let targetPaneId = 'price';

        if (!isOverlay) {
            let assigned = this.instanceSubpaneMap.get(model.id);
            if (!assigned) {
                this.paneCounter += 1;
                assigned = `subpane_${this.paneCounter}`;
                this.instanceSubpaneMap.set(model.id, assigned);
            }
            targetPaneId = assigned;
        }

        const seriesPaneMap = new Map<string, string>();
        for (const s of model.series) {
            if (s.overlay) {
                s.paneId = 'price';
                seriesPaneMap.set(s.id, 'price');
            } else {
                s.paneId = targetPaneId;
                seriesPaneMap.set(s.id, targetPaneId);
            }
        }

        for (const f of model.fills) {
            if (f.overlay) f.paneId = 'price';
            else f.paneId = targetPaneId;
        }

        for (const b of model.backgrounds) {
            if (b.overlay) b.paneId = 'price';
            else b.paneId = targetPaneId;
        }

        for (const pl of model.priceLines) {
            pl.paneId = targetPaneId;
        }

        if (model.lines) {
            for (const ln of model.lines) {
                if (ln.overlay) ln.paneId = 'price';
                else ln.paneId = targetPaneId;
            }
        }

        if (model.boxes) {
            for (const bx of model.boxes) {
                if (bx.overlay) bx.paneId = 'price';
                else bx.paneId = targetPaneId;
            }
        }

        if (model.labels) {
            for (const lb of model.labels) {
                if (lb.overlay) lb.paneId = 'price';
                else lb.paneId = targetPaneId;
            }
        }

        if (model.polylines) {
            for (const poly of model.polylines) {
                if (poly.overlay) poly.paneId = 'price';
                else poly.paneId = targetPaneId;
            }
        }

        if (model.linefills) {
            for (const lf of model.linefills) {
                if (lf.overlay) lf.paneId = 'price';
                else lf.paneId = targetPaneId;
            }
        }

        if (model.tables) {
            for (const tb of model.tables) {
                tb.paneId = targetPaneId;
            }
        }

        return { targetPaneId, seriesPaneMap };
    }

    /**
     * Loads and mounts a PineRun (or raw context) into the chart adapter.
     */
    loadPineRun(runOrContext: PineRun | unknown, instanceId = 'indicator-1'): IndicatorModel {
        const { model } = SceneTranslator.translate(runOrContext, instanceId);
        this.routeIndicatorModel(model);
        this.mountedIndicators.set(instanceId, model);

        if (model.trades && model.trades.length > 0) {
            this.setTrades(model.trades);
        }

        return model;
    }

    /**
     * Sets trades directly into marker layer and triggers repaint.
     */
    setTrades(trades: readonly TradeExecution[]): void {
        this.markerLayer.setTrades(trades);
        this.requestMarkerRepaint();
    }

    highlightTrade(tradeId: string | null): void {
        this.markerLayer.setHighlightedTradeId(tradeId);
        this.requestMarkerRepaint();
    }

    selectTrade(tradeId: string | null): void {
        this.markerLayer.setSelectedTradeId(tradeId);
        this.requestMarkerRepaint();
    }

    /**
     * Centers the chart viewport on a specific timestamp (in milliseconds).
     */
    centerOnTime(timestamp: number): void {
        if (!this.vela) return;

        let span = 100 * 60_000;
        const velaAny = this.vela as any;

        if (typeof velaAny.getVisibleRange === 'function') {
            const range = velaAny.getVisibleRange();
            if (range && range.from != null && range.to != null && range.to > range.from) {
                span = range.to - range.from;
            }
        } else if (typeof velaAny.getTimeRange === 'function') {
            const range = velaAny.getTimeRange();
            if (range && range.from != null && range.to != null && range.to > range.from) {
                span = range.to - range.from;
            }
        }

        const halfSpan = span / 2;
        const from = timestamp - halfSpan;
        const to = timestamp + halfSpan;

        if (typeof velaAny.setVisibleRange === 'function') {
            velaAny.setVisibleRange({ from, to });
        } else if (typeof velaAny.scrollToTime === 'function') {
            velaAny.scrollToTime(timestamp);
        }

        this.requestMarkerRepaint();
    }

    /**
     * Triggers a visual pulse glow animation on the trade marker for tradeId.
     */
    pulseGlow(tradeId: string): void {
        this.markerLayer.pulseGlow(tradeId);
        this.requestMarkerRepaint();
    }

    /**
     * Updates or appends a real-time candle bar on the active chart.
     */
    updateCandle(bar: {
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }): void {
        if (!this.vela) return;
        const velaAny = this.vela as any;
        if (typeof velaAny.updateCandle === 'function') {
            velaAny.updateCandle(bar);
        } else if (typeof velaAny.updateBar === 'function') {
            velaAny.updateBar(bar);
        }
        this.requestMarkerRepaint();
    }

    onHoverTrade(cb: (event: HoverTradeEvent | null) => void): () => void {
        return this.markerInteraction.onHover(cb);
    }

    onClickTradeMarker(cb: (event: ClickTradeEvent) => void): () => void {
        return this.markerInteraction.onClick(cb);
    }

    requestMarkerRepaint(): void {
        if (!this.markerCanvas || !this.container) return;
        const rect = this.container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.handleResize(rect.width, rect.height);
        }
    }

    updateMarkerLayout(deps: TradeMarkerDeps): void {
        this.markerLayer.computeLayout(deps);
        this.requestMarkerRepaint();
    }

    destroy(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.markerInteraction) {
            this.markerInteraction.detach();
        }
        if (this.markerCanvas && this.markerCanvas.parentNode) {
            this.markerCanvas.parentNode.removeChild(this.markerCanvas);
            this.markerCanvas = null;
        }
        if (this.vela) {
            try {
                if (typeof (this.vela as unknown as { destroy?: () => void }).destroy === 'function') {
                    (this.vela as unknown as { destroy: () => void }).destroy();
                }
            } catch {
                // cleanup
            }
            this.vela = null;
        }
        this.container = null;
        this.mountedIndicators.clear();
    }
}
