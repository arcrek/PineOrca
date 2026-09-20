import type { PineRun, PinePlot, PinePlotPoint, PineRunMeta, PineTrade } from './types.js';
import { asString, asNumber } from './types.js';

interface RawContext {
    fullContext?: RawContext;
    plots?: Record<string, RawPlot | undefined>;
    indicator?: Record<string, unknown>;
    strategy?: {
        config?: Record<string, unknown>;
        opentrades?: unknown[];
        closedtrades?: unknown[];
    };
}

interface RawPlot {
    title?: unknown;
    options?: Record<string, unknown>;
    data?: PinePlotPoint[];
    plot1?: unknown;
    plot2?: unknown;
}

function asBool(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'object' && value !== null && Array.isArray((value as { data?: unknown }).data)) {
        const s = value as { data: unknown[]; offset?: number };
        return asBool(s.data[s.offset ?? 0]);
    }
    return undefined;
}

function dedupeByTime(data: PinePlotPoint[]): PinePlotPoint[] {
    const lastIdx = new Map<number, number>();
    let hasDup = false;
    for (let i = 0; i < data.length; i += 1) {
        const t = data[i]!.time;
        if (lastIdx.has(t)) hasDup = true;
        lastIdx.set(t, i);
    }
    if (!hasDup) return data;
    const kept = new Set(lastIdx.values());
    return data.filter((_, i) => kept.has(i));
}

function normalizeTrades(strategy: NonNullable<RawContext['strategy']>): PineTrade[] {
    const out: PineTrade[] = [];
    const closed = Array.isArray(strategy.closedtrades) ? strategy.closedtrades : [];
    const open = Array.isArray(strategy.opentrades) ? strategy.opentrades : [];
    for (const raw of [...closed, ...open]) {
        const t = (raw ?? {}) as Record<string, unknown>;
        const entry_price = asNumber(t.entry_price);
        const entry_time = asNumber(t.entry_time);
        const size = asNumber(t.size);
        if (entry_price === undefined || entry_time === undefined || size === undefined || size === 0) continue;
        out.push({
            id: asString(t.id) ?? `trade_${out.length}`,
            entry_id: asString(t.entry_id) ?? '',
            entry_price,
            entry_time,
            entry_comment: asString(t.entry_comment),
            exit_id: asString(t.exit_id),
            exit_price: asNumber(t.exit_price),
            exit_time: asNumber(t.exit_time),
            exit_comment: asString(t.exit_comment),
            size,
            status: t.status === 'open' ? 'open' : 'closed',
            profit: asNumber(t.profit),
        });
    }
    return out;
}

export function normalizeContext(ctx: unknown): PineRun {
    const root = ((ctx as RawContext)?.fullContext ?? ctx) as RawContext;
    const ind = root.indicator ?? root.strategy?.config ?? {};
    const meta: PineRunMeta = {
        title: asString(ind.title) ?? asString(ind.name) ?? 'Indicator',
        overlay: asBool(ind.overlay) ?? false,
        precision: asNumber(ind.precision),
        shorttitle: asString(ind.shorttitle),
        format: asString(ind.format),
    };

    const plotsObj = root.plots ?? {};
    const plots: PinePlot[] = Object.entries(plotsObj).map(([key, raw]) => {
        const p = raw ?? {};
        const options = (p.options ?? {});
        return {
            key,
            title: asString(p.title),
            style: asString(options.style),
            options,
            data: Array.isArray(p.data) ? dedupeByTime(p.data) : [],
            plot1: asString(p.plot1) ?? asString(options.plot1),
            plot2: asString(p.plot2) ?? asString(options.plot2),
        };
    });

    const trades = root.strategy ? normalizeTrades(root.strategy) : undefined;
    return { meta, plots, ...(trades ? { trades } : {}) };
}
