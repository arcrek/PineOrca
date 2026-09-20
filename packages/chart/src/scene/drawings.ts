import type { LineStyle } from '@luxalgo/vela/plugin';
import type {
    DrawingLine,
    DrawingBox,
    DrawingXLoc,
    DrawingExtend,
    BoxTextSize,
    BoxHAlign,
    BoxVAlign,
    BoxFontFamily,
    DrawingLabel,
    LabelStyle,
    LabelYLoc,
    PolylinePoint,
    DrawingPolyline,
    DrawingLinefill,
    TablePosition,
    TableCell,
    TableMerge,
    DrawingTable,
} from '@luxalgo/vela/plugin';
import type { PinePlot } from './types.js';
import { asString } from './types.js';
import { normColor } from './colors.js';
import type { IdentityMap } from './identityMap.js';

function liveObjects(plot: PinePlot): Array<Record<string, unknown>> {
    const points = plot.data;
    if (points.length === 0) return [];
    const value = points[points.length - 1]?.value as unknown;
    return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function coerceNum(v: unknown): number | undefined {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (v && typeof v === 'object') {
        const o = v as { data?: unknown; offset?: unknown };
        if (Array.isArray(o.data)) {
            const off = typeof o.offset === 'number' ? o.offset : 0;
            const x = o.data[o.data.length - 1 - off];
            return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
        }
    }
    return undefined;
}

function normXLoc(raw: unknown): DrawingXLoc {
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'bi' || s === 'bar_index' ? 'bar_index' : 'bar_time';
}

function normExtend(raw: unknown): DrawingExtend {
    const s = (asString(raw) ?? '').toLowerCase();
    if (s === 'l' || s === 'left') return 'left';
    if (s === 'r' || s === 'right') return 'right';
    if (s === 'b' || s === 'both') return 'both';
    return 'none';
}

function lineStyleOf(raw: unknown): LineStyle {
    const s = (asString(raw) ?? '').toLowerCase();
    if (s === 'dashed' || s.includes('dashed')) return 'dashed';
    if (s === 'dotted' || s.includes('dotted')) return 'dotted';
    return 'solid';
}

function lineFromObject(o: Record<string, unknown>, id: string): DrawingLine | null {
    const x1 = coerceNum(o.x1);
    const y1 = coerceNum(o.y1);
    const x2 = coerceNum(o.x2);
    const y2 = coerceNum(o.y2);
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
    const color = normColor(o.color);
    const styleStr = (asString(o.style) ?? '').toLowerCase();
    return {
        id,
        paneId: 'unrouted',
        x1,
        y1,
        x2,
        y2,
        xloc: normXLoc(o.xloc),
        extend: normExtend(o.extend),
        color,
        invisible: !color,
        width: Math.max(0, coerceNum(o.width) ?? 1),
        style: lineStyleOf(o.style),
        arrowLeft: styleStr.includes('arrow_left') || styleStr.includes('arrow_both'),
        arrowRight: styleStr.includes('arrow_right') || styleStr.includes('arrow_both'),
        overlay: o.force_overlay === true,
    };
}

export function toLines(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingLine[] {
    const out: DrawingLine[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const ln = lineFromObject(o, ids.next(instanceId, 'line', String(o.id ?? out.length)));
        if (ln) out.push(ln);
    }
    return out;
}

export function toLinefills(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingLinefill[] {
    const out: DrawingLinefill[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const l1 = o.line1 as Record<string, unknown> | undefined;
        const l2 = o.line2 as Record<string, unknown> | undefined;
        if (!l1 || !l2) continue;
        const id = ids.next(instanceId, 'linefill', String(o.id ?? out.length));
        const line1 = lineFromObject(l1, `${id}:a`);
        const line2 = lineFromObject(l2, `${id}:b`);
        if (!line1 || !line2) continue;
        out.push({ id, paneId: 'unrouted', line1, line2, color: normColor(o.color), overlay: o.force_overlay === true });
    }
    return out;
}

function nearestNamedSize(px: number): BoxTextSize {
    if (px <= 0) return 'auto';
    if (px <= 9) return 'tiny';
    if (px <= 12) return 'small';
    if (px <= 17) return 'normal';
    if (px <= 28) return 'large';
    return 'huge';
}

function normTextSize(raw: unknown): BoxTextSize {
    if (typeof raw === 'number' && Number.isFinite(raw)) return nearestNamedSize(raw);
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'tiny' || s === 'small' || s === 'normal' || s === 'large' || s === 'huge' ? s : 'auto';
}

function normHAlign(raw: unknown): BoxHAlign {
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'left' || s === 'right' ? s : 'center';
}

function normVAlign(raw: unknown): BoxVAlign {
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'top' || s === 'bottom' ? s : 'center';
}

function normFont(raw: unknown): BoxFontFamily {
    const s = (asString(raw) ?? '').toLowerCase();
    return s.includes('mono') ? 'monospace' : 'default';
}

export function toBoxes(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingBox[] {
    const out: DrawingBox[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const left = coerceNum(o.left);
        const top = coerceNum(o.top);
        const right = coerceNum(o.right);
        const bottom = coerceNum(o.bottom);
        if (left === undefined || top === undefined || right === undefined || bottom === undefined) continue;
        const textStr = asString(o.text);
        const fmt = (asString(o.text_formatting) ?? '').toLowerCase();
        out.push({
            id: ids.next(instanceId, 'box', String(o.id ?? out.length)),
            paneId: 'unrouted',
            left,
            top,
            right,
            bottom,
            xloc: normXLoc(o.xloc),
            extend: normExtend(o.extend),
            bgColor: normColor(o.bgcolor),
            borderColor: normColor(o.border_color),
            borderWidth: Math.max(0, coerceNum(o.border_width) ?? 1),
            borderStyle: lineStyleOf(o.border_style),
            text: textStr && textStr.length > 0 ? textStr : undefined,
            textColor: normColor(o.text_color),
            textSize: normTextSize(o.text_size),
            hAlign: normHAlign(o.text_halign),
            vAlign: normVAlign(o.text_valign),
            wrap: (asString(o.text_wrap) ?? '').toLowerCase().includes('auto'),
            fontFamily: normFont(o.text_font_family),
            bold: fmt.includes('bold'),
            italic: fmt.includes('italic'),
            overlay: o.force_overlay === true,
        });
    }
    return out;
}

const LABEL_STYLES: readonly LabelStyle[] = [
    'label_up', 'label_down', 'label_left', 'label_right', 'label_center',
    'label_lower_left', 'label_lower_right', 'label_upper_left', 'label_upper_right',
    'circle', 'square', 'diamond', 'flag', 'arrowup', 'arrowdown',
    'triangleup', 'triangledown', 'cross', 'xcross', 'text_outline', 'none',
];

function normLabelStyle(raw: unknown): LabelStyle {
    const s = (asString(raw) ?? '').toLowerCase().replace(/^style_/, '');
    return (LABEL_STYLES as readonly string[]).includes(s) ? (s as LabelStyle) : 'label_down';
}

function normYLoc(raw: unknown): LabelYLoc {
    const s = (asString(raw) ?? '').toLowerCase();
    if (s === 'ab' || s.includes('above')) return 'abovebar';
    if (s === 'bl' || s.includes('below')) return 'belowbar';
    return 'price';
}

function normLabelSize(raw: unknown): BoxTextSize {
    if (typeof raw === 'number' && Number.isFinite(raw)) return nearestNamedSize(raw);
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'auto' || s === 'tiny' || s === 'small' || s === 'large' || s === 'huge' ? s : 'normal';
}

export function toLabels(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingLabel[] {
    const out: DrawingLabel[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const x = coerceNum(o.x);
        const y = coerceNum(o.y);
        if (x === undefined || y === undefined) continue;
        const textStr = asString(o.text);
        const tip = asString(o.tooltip);
        out.push({
            id: ids.next(instanceId, 'label', String(o.id ?? out.length)),
            paneId: 'unrouted',
            x,
            y,
            xloc: normXLoc(o.xloc),
            yloc: normYLoc(o.yloc),
            style: normLabelStyle(o.style),
            color: normColor(o.color),
            textColor: normColor(o.textcolor ?? o.text_color),
            size: normLabelSize(o.size),
            text: textStr && textStr.length > 0 ? textStr : undefined,
            textAlign: normHAlign(o.text_align),
            tooltip: tip && tip.length > 0 ? tip : undefined,
            fontFamily: normFont(o.text_font_family),
            overlay: o.force_overlay === true,
        });
    }
    return out;
}

function parsePolylinePoints(raw: unknown): PolylinePoint[] {
    if (!Array.isArray(raw)) return [];
    const out: PolylinePoint[] = [];
    for (const p of raw) {
        if (!p || typeof p !== 'object') continue;
        const x = coerceNum((p as Record<string, unknown>).x);
        const y = coerceNum((p as Record<string, unknown>).y);
        if (x === undefined || y === undefined) continue;
        out.push({ xloc: 'bar_time', x: Math.round(x), price: y });
    }
    return out;
}

export function toPolylines(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingPolyline[] {
    const out: DrawingPolyline[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const points = parsePolylinePoints(o.points);
        if (points.length === 0) continue;
        out.push({
            id: ids.next(instanceId, 'polyline', String(o.id ?? out.length)),
            paneId: 'unrouted',
            points,
            lineColor: normColor(o.line_color),
            fillColor: normColor(o.fill_color),
            lineWidth: Math.max(0, coerceNum(o.line_width) ?? 1),
            lineStyle: lineStyleOf(o.line_style),
            curved: o.curved === true,
            closed: o.closed === true,
            arrowLeft: false,
            arrowRight: false,
            overlay: o.force_overlay === true,
        });
    }
    return out;
}

const TABLE_POSITIONS: Record<string, TablePosition> = {
    top_left: 'top_left',
    top_center: 'top_center',
    top_right: 'top_right',
    middle_left: 'middle_left',
    middle_center: 'middle_center',
    middle_right: 'middle_right',
    bottom_left: 'bottom_left',
    bottom_center: 'bottom_center',
    bottom_right: 'bottom_right',
};

function normTablePosition(raw: unknown): TablePosition {
    const s = (asString(raw) ?? '').toLowerCase().replace(/^position\./, '');
    return TABLE_POSITIONS[s] ?? 'top_right';
}

function normCellSize(raw: unknown): BoxTextSize {
    if (typeof raw === 'number' && Number.isFinite(raw)) return nearestNamedSize(raw);
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'auto' || s === 'tiny' || s === 'small' || s === 'large' || s === 'huge' ? s : 'normal';
}

function normCellDim(raw: unknown): number | undefined {
    const n = coerceNum(raw);
    return n !== undefined && n > 0 ? n : undefined;
}

interface RawCellData extends TableCell {
    col: number;
    row: number;
}

function parseCell(raw: unknown): RawCellData | null {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const col = coerceNum(c.col ?? c.column);
    const row = coerceNum(c.row);
    if (col === undefined || row === undefined) return null;
    const text = asString(c.text);
    const tip = asString(c.tooltip);
    const fmt = (asString(c.text_formatting) ?? '').toLowerCase();
    return {
        col: Math.round(col),
        row: Math.round(row),
        text: text ?? '',
        textColor: normColor(c.text_color),
        bgColor: normColor(c.bgcolor),
        hAlign: normHAlign(c.text_halign),
        vAlign: normVAlign(c.text_valign),
        textSize: normCellSize(c.text_size),
        fontFamily: normFont(c.text_font_family),
        tooltip: tip && tip.length > 0 ? tip : undefined,
        bold: fmt.includes('bold'),
        italic: fmt.includes('italic'),
        width: normCellDim(c.width),
        height: normCellDim(c.height),
        merged: c._merged === true,
    };
}

function parseMerges(raw: unknown): TableMerge[] {
    if (!Array.isArray(raw)) return [];
    const out: TableMerge[] = [];
    const seen = new Set<string>();
    for (const m of raw) {
        if (!m || typeof m !== 'object') continue;
        const o = m as Record<string, unknown>;
        const sc = coerceNum(o.startCol ?? o.start_column ?? o.startColumn);
        const sr = coerceNum(o.startRow ?? o.start_row);
        const ec = coerceNum(o.endCol ?? o.end_column ?? o.endColumn);
        const er = coerceNum(o.endRow ?? o.end_row);
        if (sc === undefined || sr === undefined || ec === undefined || er === undefined) continue;
        const merge: TableMerge = {
            startCol: Math.min(Math.round(sc), Math.round(ec)),
            startRow: Math.min(Math.round(sr), Math.round(er)),
            endCol: Math.max(Math.round(sc), Math.round(ec)),
            endRow: Math.max(Math.round(sr), Math.round(er)),
        };
        const key = `${merge.startCol}:${merge.startRow}:${merge.endCol}:${merge.endRow}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(merge);
    }
    return out;
}

export function toTables(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingTable[] {
    const out: DrawingTable[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const rawCells = (Array.isArray(o.cells) ? o.cells : (o._cells as unknown)) as unknown[];
        const cols = Math.max(1, Math.round(coerceNum(o.columns) ?? 1));
        const rows = Math.max(1, Math.round(coerceNum(o.rows) ?? 1));

        // 2D grid row-major: cells[row][col]
        const cellsGrid: Array<Array<TableCell | null>> = Array.from({ length: rows }, () =>
            new Array<TableCell | null>(cols).fill(null),
        );

        if (Array.isArray(rawCells)) {
            for (const c of rawCells) {
                const cell = parseCell(c);
                if (cell && cell.row < rows && cell.col < cols) {
                    cellsGrid[cell.row]![cell.col] = {
                        text: cell.text,
                        textColor: cell.textColor,
                        bgColor: cell.bgColor,
                        hAlign: cell.hAlign,
                        vAlign: cell.vAlign,
                        textSize: cell.textSize,
                        fontFamily: cell.fontFamily,
                        tooltip: cell.tooltip,
                        bold: cell.bold,
                        italic: cell.italic,
                        width: cell.width,
                        height: cell.height,
                        merged: cell.merged,
                    };
                }
            }
        }

        out.push({
            id: ids.next(instanceId, 'table', String(o.id ?? out.length)),
            paneId: 'unrouted',
            position: normTablePosition(o.position),
            columns: cols,
            rows,
            bgColor: normColor(o.bgcolor),
            frameColor: normColor(o.frame_color),
            frameWidth: Math.max(0, coerceNum(o.frame_width) ?? 0),
            borderColor: normColor(o.border_color),
            borderWidth: Math.max(0, coerceNum(o.border_width) ?? 0),
            cells: cellsGrid,
            merges: parseMerges(o.merges ?? o._merges),
        });
    }
    return out;
}
