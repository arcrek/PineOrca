import type { SeriesKind } from '@luxalgo/vela/plugin';

/** How a Pine plot maps into the model. */
export type PlotClass =
    | SeriesKind
    | 'fill'
    | 'background'
    | 'hline'
    | 'barcolor'
    | 'drawing_line'
    | 'drawing_box'
    | 'label'
    | 'drawing_polyline'
    | 'linefill'
    | 'table'
    | 'skip';

const STYLE_TO_CLASS: Record<string, PlotClass> = {
    line: 'line',
    style_line: 'line',
    style_linebr: 'line',
    style_area: 'area',
    style_areabr: 'area',
    style_stepline: 'step',
    style_steplinebr: 'step',
    style_stepline_diamond: 'step',
    style_histogram: 'histogram',
    style_columns: 'columns',
    style_circles: 'circles',
    style_cross: 'cross',
    shape: 'markers',
    char: 'markers',
    bar: 'bar',
    candle: 'candle',
    background: 'background',
    barcolor: 'barcolor',
    hline: 'hline',
    fill: 'fill',
    drawing_line: 'drawing_line',
    drawing_box: 'drawing_box',
    label: 'label',
    drawing_polyline: 'drawing_polyline',
    linefill: 'linefill',
    table: 'table',
};

export function isKnownStyle(style: string | undefined): boolean {
    return style == null || style === '' || style in STYLE_TO_CLASS;
}

/** Classify a plot's style; unknown -> line. */
export function classifyStyle(style: string | undefined): PlotClass {
    if (style == null || style === '') return 'line';
    return STYLE_TO_CLASS[style] ?? 'line';
}
