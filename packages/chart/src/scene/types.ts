/**
 * Contract for what SceneTranslator reads from a PineTS run.
 */
export interface PinePlotPoint {
    time: number; // epoch ms (PineTS openTime)
    value: number | number[] | boolean | null;
    options?: Record<string, unknown>;
}

export interface PinePlot {
    key: string;
    title?: string;
    style?: string;
    options: Record<string, unknown>;
    data: PinePlotPoint[];
    /** fill() references to other plot keys */
    plot1?: string;
    plot2?: string;
}

export interface PineRunMeta {
    title: string;
    overlay: boolean;
    precision?: number;
    shorttitle?: string;
    format?: string;
}

/**
 * One trade from the broker emulator's ledger (open or closed).
 * `size` is SIGNED (positive = long, negative = short).
 */
export interface PineTrade {
    id: string;
    entry_id: string;
    entry_price: number;
    entry_time: number;
    entry_comment?: string;
    exit_id?: string;
    exit_price?: number;
    exit_time?: number;
    exit_comment?: string;
    size: number;
    status: 'open' | 'closed';
    profit?: number;
}

export interface PineRun {
    meta: PineRunMeta;
    plots: PinePlot[];
    /** The strategy ledger (closed then open trades); absent for indicator scripts. */
    trades?: PineTrade[];
}

export function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
