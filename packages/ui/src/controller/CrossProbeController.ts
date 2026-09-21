// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import type { TradeRowItem } from '../tester/tabs/ListOfTradesTab.js';

export interface MarkerLayerProbeTarget {
    setSelectedTradeId(tradeId: string | null): void;
    setHighlightedTradeId(tradeId: string | null): void;
    pulseGlow?(tradeId: string): void;
    getSelectedTradeId?(): string | null;
    getHighlightedTradeId?(): string | null;
}

export interface MarkerInteractionProbeTarget {
    onHover(cb: (event: { tradeId: string | null } | null) => void): () => void;
    onClick(cb: (event: { tradeId: string | null }) => void): () => void;
}

export interface ChartProbeTarget {
    centerOnTime?(timestamp: number): void;
    centerOnLogical?(logical: number): void;
    pulseGlow?(tradeId: string): void;
    getMarkerLayer?(): MarkerLayerProbeTarget;
    getMarkerInteraction?(): MarkerInteractionProbeTarget;
}

export interface TradesTableProbeTarget {
    selectRow(tradeId: string | null): void;
    highlightRow(tradeId: string | null): void;
    scrollToTrade(tradeId: string): void;
    onRowClick(cb: (row: TradeRowItem) => void): () => void;
    onRowHover(cb: (row: TradeRowItem | null) => void): () => void;
}

export interface CrossProbeEvent {
    source: 'table' | 'chart';
    action: 'select' | 'hover';
    tradeId: string | null;
    timestamp?: number;
    latencyMs?: number;
}

export type CrossProbeCallback = (evt: CrossProbeEvent) => void;

/**
 * Bi-directional selection and camera synchronization controller between
 * the virtualized List of Trades table and the WebGL2 chart canvas / trade markers.
 */
export class CrossProbeController {
    private chart: ChartProbeTarget | null = null;
    private table: TradesTableProbeTarget | null = null;

    private unbindTableClick: (() => void) | null = null;
    private unbindTableHover: (() => void) | null = null;
    private unbindChartHover: (() => void) | null = null;
    private unbindChartClick: (() => void) | null = null;

    private syncListeners = new Set<CrossProbeCallback>();
    private pulseGlowTradeId: string | null = null;
    private glowTimeoutId: number | NodeJS.Timeout | undefined = undefined;

    constructor(chart?: ChartProbeTarget, table?: TradesTableProbeTarget) {
        if (chart && table) {
            this.attach(chart, table);
        }
    }

    attach(chart: ChartProbeTarget, table: TradesTableProbeTarget): void {
        this.detach();
        this.attachTable(table);
        this.attachChart(chart);
    }

    attachTable(table: TradesTableProbeTarget): void {
        if (this.unbindTableClick) {
            this.unbindTableClick();
            this.unbindTableClick = null;
        }
        if (this.unbindTableHover) {
            this.unbindTableHover();
            this.unbindTableHover = null;
        }
        this.table = table;

        // 1. Table -> Chart: Click trade row
        this.unbindTableClick = table.onRowClick((row) => {
            const start = performance.now();
            if (this.chart) {
                if (this.chart.centerOnTime) {
                    this.chart.centerOnTime(row.time);
                } else if (this.chart.centerOnLogical && row.barIndex != null) {
                    this.chart.centerOnLogical(row.barIndex);
                }
                const markerLayer = this.chart.getMarkerLayer ? this.chart.getMarkerLayer() : null;
                if (markerLayer) {
                    markerLayer.setSelectedTradeId(row.tradeId);
                    if (markerLayer.pulseGlow) {
                        markerLayer.pulseGlow(row.tradeId);
                    }
                }
                if (this.chart.pulseGlow) {
                    this.chart.pulseGlow(row.tradeId);
                }
            }

            this.triggerPulseGlow(row.tradeId);
            const latencyMs = performance.now() - start;
            this.emitSync({
                source: 'table',
                action: 'select',
                tradeId: row.tradeId,
                timestamp: row.time,
                latencyMs,
            });
        });

        // 2. Table -> Chart: Hover trade row
        this.unbindTableHover = table.onRowHover((row) => {
            if (this.chart) {
                const markerLayer = this.chart.getMarkerLayer ? this.chart.getMarkerLayer() : null;
                if (markerLayer) {
                    markerLayer.setHighlightedTradeId(row ? row.tradeId : null);
                }
            }
            this.emitSync({
                source: 'table',
                action: 'hover',
                tradeId: row ? row.tradeId : null,
                timestamp: row ? row.time : undefined,
            });
        });
    }

    attachChart(chart: ChartProbeTarget): void {
        if (this.unbindChartHover) {
            this.unbindChartHover();
            this.unbindChartHover = null;
        }
        if (this.unbindChartClick) {
            this.unbindChartClick();
            this.unbindChartClick = null;
        }
        this.chart = chart;

        const interaction = chart.getMarkerInteraction ? chart.getMarkerInteraction() : null;
        if (interaction) {
            // 3. Chart -> Table: Hover trade marker
            this.unbindChartHover = interaction.onHover((evt) => {
                const tradeId = evt ? evt.tradeId : null;
                if (this.table) {
                    this.table.highlightRow(tradeId);
                }
                this.emitSync({
                    source: 'chart',
                    action: 'hover',
                    tradeId,
                });
            });

            // 4. Chart -> Table: Click trade marker
            this.unbindChartClick = interaction.onClick((evt) => {
                const tradeId = evt.tradeId;
                if (this.table) {
                    this.table.selectRow(tradeId);
                    if (tradeId) {
                        this.table.scrollToTrade(tradeId);
                    }
                }
                this.emitSync({
                    source: 'chart',
                    action: 'select',
                    tradeId,
                });
            });
        }
    }

    detach(): void {
        if (this.unbindTableClick) {
            this.unbindTableClick();
            this.unbindTableClick = null;
        }
        if (this.unbindTableHover) {
            this.unbindTableHover();
            this.unbindTableHover = null;
        }
        if (this.unbindChartHover) {
            this.unbindChartHover();
            this.unbindChartHover = null;
        }
        if (this.unbindChartClick) {
            this.unbindChartClick();
            this.unbindChartClick = null;
        }
        clearTimeout(this.glowTimeoutId);
        this.glowTimeoutId = undefined;
        this.chart = null;
        this.table = null;
    }

    destroy(): void {
        this.detach();
        this.syncListeners.clear();
    }

    onSync(cb: CrossProbeCallback): () => void {
        this.syncListeners.add(cb);
        return () => this.syncListeners.delete(cb);
    }

    triggerPulseGlow(tradeId: string): void {
        this.pulseGlowTradeId = tradeId;
        clearTimeout(this.glowTimeoutId);
        // Pulse glow lasts 1200ms
        this.glowTimeoutId = setTimeout(() => {
            if (this.pulseGlowTradeId === tradeId) {
                this.pulseGlowTradeId = null;
            }
            this.glowTimeoutId = undefined;
        }, 1200);
    }

    getPulseGlowTradeId(): string | null {
        return this.pulseGlowTradeId;
    }

    private emitSync(event: CrossProbeEvent): void {
        for (const listener of this.syncListeners) {
            listener(event);
        }
    }
}
