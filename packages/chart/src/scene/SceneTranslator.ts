import type {
    OHLCV,
    IndicatorModel,
    SeriesSpec,
    SeriesPoint,
    LineLikeKind,
    LineLikeStyle,
    LineStyle,
    CandleSeries,
    CandleBarColor,
    SeriesDisplay,
    Fill,
    FillGradientStop,
    Background,
    PriceLine,
    DrawingLine,
    DrawingBox,
    DrawingLabel,
    DrawingPolyline,
    DrawingLinefill,
    DrawingTable,
    TradeExecution,
} from '@luxalgo/vela/plugin';
import { ACCENT, BULLISH, BEARISH } from '@luxalgo/vela/plugin';
import type { PineRun, PinePlot, PineTrade, PinePlotPoint } from './types.js';
import { asString, asNumber } from './types.js';
import { classifyStyle } from './styleMap.js';
import { normColor, isVisibleColor, INVISIBLE_COLOR } from './colors.js';
import { IdentityMap } from './identityMap.js';
import { toLines, toBoxes, toLabels, toPolylines, toLinefills, toTables } from './drawings.js';
import { normalizeContext } from './normalizeContext.js';

const DEFAULT_COLOR = ACCENT;

export interface ToSceneResult {
    model: IndicatorModel;
    warnings: string[];
}

export class SceneTranslator {
    /**
     * Translates a normalized PineRun or raw engine context into a renderer-neutral IndicatorModel.
     */
    static translate(runOrContext: PineRun | unknown, instanceId = 'indicator-1'): ToSceneResult {
        const run = isPineRun(runOrContext) ? runOrContext : normalizeContext(runOrContext);
        return toScene(run, instanceId);
    }

    /**
     * Converts trades into chart executions with FIFO lot merging.
     */
    static tradesToExecutions(trades: PineTrade[]): TradeExecution[] {
        return tradesToExecutions(trades);
    }
}

function isPineRun(v: unknown): v is PineRun {
    if (!v || typeof v !== 'object') return false;
    const r = v as Partial<PineRun>;
    return Boolean(r.meta && typeof r.meta === 'object' && Array.isArray(r.plots));
}

/**
 * Pure transform: a normalized PineTS run -> a renderer-neutral IndicatorModel.
 * paneId is left as 'unrouted' — the orchestrator stamps the real pane id.
 */
export function toScene(run: PineRun, instanceId: string): ToSceneResult {
    const ids = new IdentityMap();
    const warnings: string[] = [];
    const series: SeriesSpec[] = [];
    const fills: Fill[] = [];
    const backgrounds: Background[] = [];
    const priceLines: PriceLine[] = [];
    const lines: DrawingLine[] = [];
    const boxes: DrawingBox[] = [];
    const labels: DrawingLabel[] = [];
    const polylines: DrawingPolyline[] = [];
    const linefills: DrawingLinefill[] = [];
    const tables: DrawingTable[] = [];
    const barColors: Array<{ time: number; color: string }> = [];
    const keyToSeriesId = new Map<string, string>();
    const overlayKeys = new Set<string>();

    const pendingFills: PinePlot[] = [];

    for (const plot of run.plots) {
        const style = plot.style ?? (typeof plot.options.style === 'string' ? plot.options.style : undefined);
        const cls = classifyStyle(style);
        const title = plot.title ?? plot.key;

        switch (cls) {
            case 'line':
            case 'histogram':
            case 'columns':
            case 'circles':
            case 'cross':
            case 'area':
            case 'step':
            case 'candle':
            case 'bar': {
                const spec = toSeries(cls, plot, ids.next(instanceId, cls, title), title);
                series.push(spec);
                keyToSeriesId.set(plot.key, spec.id);
                if (spec.overlay) overlayKeys.add(plot.key);
                if (plot.options.trackprice === true) {
                    const pl = trackPriceLine(spec, instanceId, ids);
                    if (pl) priceLines.push(pl);
                }
                break;
            }
            case 'barcolor': {
                if (!displayIncludesPane(plot.options.display)) break;
                const first = showLastStart(plot.data.length, asNumber(plot.options.show_last));
                for (let i = first; i < plot.data.length; i += 1) {
                    const d = plot.data[i]!;
                    const color = normColor(d.options?.color);
                    if (color) barColors.push({ time: d.time, color });
                }
                break;
            }
            case 'fill':
                if (displayIncludesPane(plot.options.display)) pendingFills.push(plot);
                break;
            case 'hline': {
                const line = toPriceLine(plot, title, instanceId, ids);
                if (line) priceLines.push(line);
                break;
            }
            case 'background':
                if (displayIncludesPane(plot.options.display)) {
                    backgrounds.push(...toBackgrounds(plot, title, instanceId, ids));
                }
                break;
            case 'drawing_line':
                lines.push(...toLines(plot, instanceId, ids));
                break;
            case 'drawing_box':
                boxes.push(...toBoxes(plot, instanceId, ids));
                break;
            case 'label':
                labels.push(...toLabels(plot, instanceId, ids));
                break;
            case 'drawing_polyline':
                polylines.push(...toPolylines(plot, instanceId, ids));
                break;
            case 'linefill':
                linefills.push(...toLinefills(plot, instanceId, ids));
                break;
            case 'table':
                tables.push(...toTables(plot, instanceId, ids));
                break;
            case 'markers':
                labels.push(...toMarkers(plot, title, instanceId, ids));
                break;
            case 'skip':
                break;
            default:
                warnings.push(`Unhandled plot class '${cls}' for plot '${plot.key}'`);
        }
    }

    for (const fill of pendingFills) {
        const fromKey = fill.plot1;
        const toKey = fill.plot2;
        if (!fromKey || !toKey) continue;
        const fromId = keyToSeriesId.get(fromKey);
        const toId = keyToSeriesId.get(toKey);
        if (!fromId || !toId) continue;
        const overlay = overlayKeys.has(fromKey) && overlayKeys.has(toKey);
        fills.push({
            id: ids.next(instanceId, 'fill', fill.title ?? fill.key),
            paneId: 'unrouted',
            fromSeriesId: fromId,
            toSeriesId: toId,
            ...extractFillStyle(fill),
            ...(overlay ? { overlay: true } : {}),
        });
    }

    const trades = run.trades ? tradesToExecutions(run.trades) : [];
    const model: IndicatorModel = {
        id: instanceId,
        title: run.meta.title,
        overlay: run.meta.overlay,
        paneHint: run.meta.overlay ? 'price' : 'new',
        series,
        fills,
        backgrounds,
        priceLines,
        lines,
        boxes,
        labels,
        polylines,
        linefills,
        tables,
        barColors: barColors.length ? barColors : undefined,
        trades: trades.length ? trades : undefined,
        inputs: [],
        inputValues: {},
    };
    return { model, warnings };
}

/**
 * Ledger trades -> chart order executions, ONE MARKER PER ORDER FILL.
 * Combines multiple FIFO lots of the same fill order into a single marker at the execution price.
 */
export interface MergedTradeExecution extends TradeExecution {
    tradeIds?: string[];
}

export function tradesToExecutions(trades: PineTrade[]): TradeExecution[] {
    const groups = new Map<string, MergedTradeExecution>();
    const fill = (e: TradeExecution): void => {
        const key = `${e.time}|${e.side}|${e.label ?? ''}`;
        const g = groups.get(key);
        if (!g) {
            const initial: MergedTradeExecution = {
                ...e,
                tradeIds: e.tradeId ? [e.tradeId] : [],
            };
            groups.set(key, initial);
            return;
        }
        g.qty = (g.qty ?? 0) + (e.qty ?? 0);
        if (e.tradeId && g.tradeIds && !g.tradeIds.includes(e.tradeId)) {
            g.tradeIds.push(e.tradeId);
        }
        if (e.kind === 'entry' && g.kind === 'exit') {
            g.kind = 'entry';
            g.price = e.price;
            g.tradeId = e.tradeId;
        }
    };
    for (const t of trades) {
        const long = t.size > 0;
        const qty = Math.abs(t.size);
        fill({
            time: t.entry_time,
            price: t.entry_price,
            side: long ? 'buy' : 'sell',
            kind: 'entry',
            label: t.entry_comment ?? t.entry_id,
            qty,
            tradeId: t.id,
        });
        if (t.status === 'closed' && t.exit_time != null && t.exit_price != null) {
            fill({
                time: t.exit_time,
                price: t.exit_price,
                side: long ? 'sell' : 'buy',
                kind: 'exit',
                label: t.exit_comment ?? t.exit_id,
                qty,
                tradeId: t.id,
            });
        }
    }

    return [...groups.values()].sort((a, b) => a.time - b.time);
}

function toSeries(cls: LineLikeKind | 'candle' | 'bar', plot: PinePlot, id: string, title: string): SeriesSpec {
    const showLast = asNumber(plot.options.show_last);
    const overlay = plot.options.force_overlay === true ? { overlay: true } : {};
    const declared = parseDisplay(plot.options.display);

    if (cls === 'candle' || cls === 'bar') {
        const spec: CandleSeries = {
            id,
            title,
            paneId: 'unrouted',
            kind: cls,
            bars: toOhlcBars(plot, showLastStart(plot.data.length, showLast)),
            visible: declared.pane,
            display: declared,
            ...overlay,
        };
        const barColors = toCandleBarColors(plot);
        if (barColors) spec.barColors = barColors;
        return spec;
    }

    const kind = cls;
    const repColor = normColor(representativeColor(plot));
    const display: SeriesDisplay = { ...declared, pane: declared.pane && !!repColor };
    const width = asNumber(plot.options.linewidth) ?? 1;
    const connected = kind === 'line' || kind === 'step' || kind === 'area';
    const points = applyOffset(applyShowLast(toPoints(plot), showLast, connected), asNumber(plot.options.offset));
    const style: LineLikeStyle = {
        color: repColor ?? DEFAULT_COLOR,
        width,
        lineStyle: asLineStyle(plot.options.linestyle) ?? 'solid',
    };

    const base = asNumber(plot.options.histbase);
    if (base !== undefined && (kind === 'histogram' || kind === 'columns' || kind === 'area')) {
        style.base = base;
    }

    return { id, title, paneId: 'unrouted', kind, points, style, visible: display.pane, display, ...overlay };
}

const DISPLAY_ALL: Required<SeriesDisplay> = { pane: true, priceScale: true, legend: true, dataWindow: true };
const DISPLAY_SURFACE = { pane: 'pane', data_window: 'dataWindow', status_line: 'legend', price_scale: 'priceScale' } as const;
const DISPLAY_TOKENS = ['all', 'none', 'pane', 'data_window', 'status_line', 'price_scale'] as const;

function parseDisplay(v: unknown): Required<SeriesDisplay> {
    if (typeof v !== 'string') return { ...DISPLAY_ALL };
    const out: Required<SeriesDisplay> = { pane: false, priceScale: false, legend: false, dataWindow: false };
    for (let i = 0; i < v.length; ) {
        const tok = DISPLAY_TOKENS.find((t) => v.startsWith(t, i));
        if (!tok || tok === 'all') return { ...DISPLAY_ALL };
        if (tok !== 'none') out[DISPLAY_SURFACE[tok]] = true;
        i += tok.length;
    }
    return out;
}

function displayIncludesPane(v: unknown): boolean {
    return parseDisplay(v).pane;
}

function showLastStart(dataLen: number, showLast: number | undefined): number {
    if (showLast === undefined || showLast <= 0) return 0;
    return Math.max(0, dataLen - Math.floor(showLast));
}

function applyShowLast(points: SeriesPoint[], showLast: number | undefined, connected: boolean): SeriesPoint[] {
    let first = showLastStart(points.length, showLast);
    if (connected) first -= 1;
    if (first <= 0) return points;
    return points.map((p, i) => (i < first ? { ...p, value: null } : p));
}

function trackPriceLine(spec: SeriesSpec, instanceId: string, ids: IdentityMap): PriceLine | null {
    if (!('points' in spec)) return null;
    const pts = (spec as { points: SeriesPoint[] }).points;
    let lastVal: number | null = null;
    for (let i = pts.length - 1; i >= 0; i -= 1) {
        const v = pts[i]?.value;
        if (typeof v === 'number' && Number.isFinite(v)) {
            lastVal = v;
            break;
        }
    }
    if (lastVal === null) return null;
    const style = 'style' in spec ? (spec.style as LineLikeStyle) : undefined;
    return {
        id: ids.next(instanceId, 'hline', `${spec.title}:trackprice`),
        paneId: 'unrouted',
        price: lastVal,
        color: style?.color ?? DEFAULT_COLOR,
        width: 1,
        lineStyle: 'dotted',
        title: spec.title,
    };
}

function toPriceLine(plot: PinePlot, title: string, instanceId: string, ids: IdentityMap): PriceLine | null {
    if (!displayIncludesPane(plot.options.display)) return null;
    const price = asNumber(plot.data[0]?.value) ?? asNumber(plot.options.price);
    if (price === undefined) return null;
    const overlay = plot.options.force_overlay === true ? { overlay: true } : {};
    return {
        id: ids.next(instanceId, 'hline', title),
        paneId: 'unrouted',
        price,
        color: normColor(plot.options.color, DEFAULT_COLOR)!,
        width: asNumber(plot.options.linewidth) ?? 1,
        lineStyle: asLineStyle(plot.options.linestyle) ?? 'dashed',
        title,
    };
}

function toPoints(plot: PinePlot): SeriesPoint[] {
    return plot.data.map((d) => {
        const v = d.value;
        const numVal = typeof v === 'number' && Number.isFinite(v) ? v : null;
        const color = d.options && 'color' in d.options ? (isVisibleColor(d.options.color) ? (d.options.color as string) : INVISIBLE_COLOR) : undefined;
        return {
            time: d.time,
            value: numVal,
            ...(color ? { color } : {}),
        };
    });
}

function inferIntervalMs(points: SeriesPoint[]): number {
    if (points.length < 2) return 0;
    const diffs: number[] = [];
    const sample = Math.min(points.length - 1, 10);
    for (let i = 0; i < sample; i += 1) {
        const dt = (points[i + 1]?.time ?? 0) - (points[i]?.time ?? 0);
        if (dt > 0) diffs.push(dt);
    }
    return diffs.length > 0 ? Math.min(...diffs) : 0;
}

function applyOffset(points: SeriesPoint[], offset: number | undefined): SeriesPoint[] {
    if (!offset) return points;
    const shift = offset * inferIntervalMs(points);
    if (!shift) return points;
    return points.map((p) => ({ ...p, time: p.time + shift }));
}

function toOhlcBars(plot: PinePlot, firstIdx = 0): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = firstIdx; i < plot.data.length; i += 1) {
        const d = plot.data[i]!;
        const v = d.value;
        if (!Array.isArray(v) || v.length < 4) continue;
        const bar: OHLCV = { time: d.time, open: v[0] ?? 0, high: v[1] ?? 0, low: v[2] ?? 0, close: v[3] ?? 0 };
        out.push(bar);
    }
    return out;
}

function representativeColor(plot: PinePlot): string | undefined {
    for (const d of plot.data) {
        if (typeof d.options?.color === 'string' && d.options.color) return d.options.color;
    }
    return asString(plot.options.color);
}

function extractFillStyle(plot: PinePlot): { color?: string; colors?: Array<string | null>; gradient?: Array<FillGradientStop | null> } {
    const isGradient =
        plot.options.gradient === true ||
        plot.data.some((d: PinePlotPoint) => d.options && (typeof d.options.top_color === 'string' || typeof d.options.bottom_color === 'string'));

    if (isGradient) {
        const gradient = plot.data.map((d: PinePlotPoint): FillGradientStop | null => {
            const o = d.options ?? {};
            const tv = asNumber(o.top_value);
            const bv = asNumber(o.bottom_value);
            if (tv === undefined || bv === undefined) return null;
            return {
                topValue: tv,
                bottomValue: bv,
                topColor: normColor(o.top_color, DEFAULT_COLOR)!,
                bottomColor: normColor(o.bottom_color, DEFAULT_COLOR)!,
            };
        });
        return { gradient };
    }

    const hasVaryingColors = plot.data.some((d: PinePlotPoint) => d.options && typeof d.options.color === 'string');
    if (hasVaryingColors) {
        const colors = plot.data.map((d: PinePlotPoint) => (d.options ? normColor(d.options.color) ?? null : null));
        return { colors };
    }

    return { color: normColor(plot.options.color, DEFAULT_COLOR) };
}

function toCandleBarColors(plot: PinePlot): CandleBarColor[] | undefined {
    const out: CandleBarColor[] = [];
    let hasAny = false;
    for (const d of plot.data) {
        const o = d.options ?? {};
        const color = normColor(o.upColor ?? o.color);
        const wickColor = normColor(o.wickColor);
        const borderColor = normColor(o.borderColor);
        if (color || wickColor || borderColor) {
            hasAny = true;
            out.push({ color, wickColor, borderColor });
        } else {
            out.push({});
        }
    }
    return hasAny ? out : undefined;
}

function asLineStyle(v: unknown): LineStyle | undefined {
    const s = asString(v)?.replace(/^(hline\.style_|plot\.linestyle_|linestyle_|style_)/, '');
    return s === 'solid' || s === 'dashed' || s === 'dotted' ? s : undefined;
}

function toBackgrounds(plot: PinePlot, title: string, instanceId: string, ids: IdentityMap): Background[] {
    const out: Background[] = [];
    const overlay = plot.options.force_overlay === true ? { overlay: true } : {};
    const data = plot.data;
    const interval = data.length > 1 ? (data[1]?.time ?? 0) - (data[0]?.time ?? 0) : 0;
    let i = showLastStart(data.length, asNumber(plot.options.show_last));
    while (i < data.length) {
        const d = data[i]!;
        const color = normColor(d.options?.color);
        if (d.value === true && color) {
            const start = d.time;
            let last = d.time;
            let j = i;
            while (j + 1 < data.length) {
                const next = data[j + 1]!;
                if (next.value === true && normColor(next.options?.color) === color) {
                    last = next.time;
                    j += 1;
                } else break;
            }
            out.push({ id: ids.next(instanceId, 'background', title), paneId: 'unrouted', from: start, to: last + interval, color, ...overlay });
            i = j + 1;
        } else {
            i += 1;
        }
    }
    return out;
}

function toMarkers(plot: PinePlot, title: string, instanceId: string, ids: IdentityMap): DrawingLabel[] {
    if (!displayIncludesPane(plot.options.display)) return [];
    const isArrow = plot.style === 'style_arrow' || plot.options.is_arrow === true;
    const isChar = plot.style === 'char';
    const arrowScale = isArrow ? arrowScaleOf(plot) : null;
    const declaredColor = normColor(plot.options.color);
    const declaredTextColor = normColor(plot.options.textcolor);
    const yloc = markerYLoc(asString(plot.options.location));
    const shape = markerShape(asString(plot.options.shape));
    const size = markerSize(asString(plot.options.size));
    const staticText = asString(plot.options.text);
    const staticChar = asString(plot.options.char) ?? '*';
    const overlay = plot.options.force_overlay === true ? { overlay: true } : {};

    const out: DrawingLabel[] = [];
    const first = showLastStart(plot.data.length, asNumber(plot.options.show_last));

    for (let i = first; i < plot.data.length; i += 1) {
        const d = plot.data[i]!;
        const v = d.value;
        const o = d.options ?? {};
        const optColor = normColor(o.color);
        const optTextColor = normColor(o.textcolor);

        if (isArrow) {
            const val = typeof v === 'number' && Number.isFinite(v) ? v : 0;
            if (val === 0) continue;
            const up = val > 0;
            const fallbackColor = up ? BULLISH : BEARISH;
            const color = optColor ?? declaredColor ?? fallbackColor;
            out.push({
                id: ids.next(instanceId, 'label', title),
                paneId: 'unrouted',
                x: d.time,
                y: 0,
                xloc: 'bar_time',
                yloc: up ? 'belowbar' : 'abovebar',
                style: up ? 'arrowup' : 'arrowdown',
                color,
                size: arrowScale ? arrowSize(Math.abs(val), arrowScale) : 'small',
                textAlign: 'center',
                fontFamily: 'default',
                ...overlay,
            });
            continue;
        }

        const active = v === true || (typeof v === 'number' && Number.isFinite(v));
        if (!active) continue;
        const color = optColor ?? declaredColor ?? DEFAULT_COLOR;
        const y = yloc === 'price' && typeof v === 'number' ? v : 0;
        const text = asString(o.text) ?? staticText;

        if (isChar) {
            const charStr = asString(o.char) ?? staticChar;
            const combinedText = text && text.length > 0 ? `${charStr}\n${text}` : charStr;
            out.push({
                id: ids.next(instanceId, 'label', title),
                paneId: 'unrouted',
                x: d.time,
                y,
                xloc: 'bar_time',
                yloc,
                style: 'none',
                textColor: color,
                text: combinedText,
                size,
                textAlign: 'center',
                fontFamily: 'default',
                ...overlay,
            });
            continue;
        }

        out.push({
            id: ids.next(instanceId, 'label', title),
            paneId: 'unrouted',
            x: d.time,
            y,
            xloc: 'bar_time',
            yloc,
            style: shape,
            color,
            textColor: optTextColor ?? declaredTextColor ?? normColor(o.text_color),
            text: text && text.length > 0 ? text : undefined,
            size,
            textAlign: 'center',
            fontFamily: 'default',
            ...overlay,
        });
    }
    return out;
}

interface ArrowScale {
    maxAbs: number;
    minH: number;
    maxH: number;
}

function arrowScaleOf(plot: PinePlot): ArrowScale {
    let maxAbs = 0;
    for (const d of plot.data) {
        if (typeof d.value === 'number' && Number.isFinite(d.value)) maxAbs = Math.max(maxAbs, Math.abs(d.value));
    }
    return { maxAbs, minH: asNumber(plot.options.minheight) ?? 5, maxH: asNumber(plot.options.maxheight) ?? 100 };
}

function arrowSize(abs: number, scale: ArrowScale): DrawingLabel['size'] {
    const t = scale.maxAbs > 0 ? abs / scale.maxAbs : 1;
    const px = scale.minH + t * (scale.maxH - scale.minH);
    if (px <= 12) return 'tiny';
    if (px <= 24) return 'small';
    if (px <= 44) return 'normal';
    if (px <= 72) return 'large';
    return 'huge';
}

function markerYLoc(location: string | undefined): DrawingLabel['yloc'] {
    const s = (location ?? '').toLowerCase();
    if (s === 'absolute') return 'price';
    if (s === 'top') return 'top';
    if (s === 'bottom') return 'bottom';
    if (s.includes('below')) return 'belowbar';
    return 'abovebar';
}

function markerShape(shape: string | undefined): DrawingLabel['style'] {
    const s = (shape ?? '').toLowerCase().replace(/^shape_/, '').replace(/_/g, '');
    switch (s) {
        case 'diamond': return 'diamond';
        case 'triangleup': return 'triangleup';
        case 'triangledown': return 'triangledown';
        case 'labelup': return 'label_up';
        case 'labeldown': return 'label_down';
        case 'arrowup': return 'arrowup';
        case 'arrowdown': return 'arrowdown';
        case 'square': return 'square';
        case 'cross': return 'cross';
        case 'xcross': return 'xcross';
        case 'flag': return 'flag';
        default: return 'circle';
    }
}

function markerSize(size: string | undefined): DrawingLabel['size'] {
    const s = (size ?? '').toLowerCase();
    return s === 'tiny' || s === 'small' || s === 'large' || s === 'huge' || s === 'normal' ? s : 'small';
}
