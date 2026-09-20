// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export interface EquityPoint {
    time: number;
    equity: number;
    buyAndHold?: number;
    drawdownPercent?: number;
}

export interface OverviewMetrics {
    netProfit: number;
    netProfitPercent: number;
    profitFactor: number;
    winRate: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    totalTrades?: number;
    avgTrade?: number;
}

/**
 * Overview tab: Metric KPI cards, interactive Equity Curve vs. Buy & Hold canvas,
 * and Underwater Drawdown percentage area chart.
 */
export class OverviewTab {
    private container: HTMLElement | null = null;
    private rootElement: HTMLElement | null = null;
    private kpiContainer: HTMLElement | null = null;
    private equityCanvas: HTMLCanvasElement | null = null;
    private drawdownCanvas: HTMLCanvasElement | null = null;
    private tooltipElement: HTMLElement | null = null;

    private metrics: OverviewMetrics = {
        netProfit: 0,
        netProfitPercent: 0,
        profitFactor: 0,
        winRate: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        totalTrades: 0,
        avgTrade: 0,
    };
    private data: EquityPoint[] = [];
    private hoveredIndex: number | null = null;

    private resizeObserver: ResizeObserver | null = null;

    mount(container: HTMLElement): void {
        this.container = container;
        this.buildDOM();
        this.render();
    }

    destroy(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
        this.rootElement = null;
        this.kpiContainer = null;
        this.equityCanvas = null;
        this.drawdownCanvas = null;
        this.tooltipElement = null;
        this.container = null;
    }

    update(metrics?: Partial<OverviewMetrics>, data?: EquityPoint[]): void {
        if (metrics) {
            this.metrics = { ...this.metrics, ...metrics };
        }
        if (data) {
            this.data = data;
        }
        this.render();
    }

    resize(width?: number, height?: number): void {
        if (!this.rootElement) return;
        const rect = this.rootElement.getBoundingClientRect();
        const w = width ?? rect.width ?? 800;
        const h = height ?? rect.height ?? 300;
        this.renderCharts(w, h);
    }

    getElement(): HTMLElement | null {
        return this.rootElement;
    }

    private buildDOM(): void {
        if (typeof document === 'undefined' || !this.container) return;

        const root = document.createElement('div');
        root.className = 'pineorca-tester-overview';
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.backgroundColor = '#131722';
        root.style.color = '#d1d4dc';
        root.style.overflow = 'hidden';
        root.style.boxSizing = 'border-box';
        root.style.padding = '8px 12px';
        root.style.gap = '8px';
        root.style.position = 'relative';
        this.rootElement = root;

        // KPI container
        const kpi = document.createElement('div');
        kpi.className = 'pineorca-overview-kpis';
        kpi.style.display = 'grid';
        kpi.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
        kpi.style.gap = '8px';
        kpi.style.flexShrink = '0';
        this.kpiContainer = kpi;
        root.appendChild(kpi);

        // Chart Area container
        const chartArea = document.createElement('div');
        chartArea.className = 'pineorca-overview-charts';
        chartArea.style.flex = '1';
        chartArea.style.display = 'flex';
        chartArea.style.flexDirection = 'column';
        chartArea.style.gap = '4px';
        chartArea.style.position = 'relative';
        chartArea.style.overflow = 'hidden';
        root.appendChild(chartArea);

        // Equity canvas wrapper
        const equityWrap = document.createElement('div');
        equityWrap.style.flex = '3';
        equityWrap.style.position = 'relative';
        equityWrap.style.minHeight = '60px';
        chartArea.appendChild(equityWrap);

        const eqCanvas = document.createElement('canvas');
        eqCanvas.style.position = 'absolute';
        eqCanvas.style.left = '0';
        eqCanvas.style.top = '0';
        eqCanvas.style.width = '100%';
        eqCanvas.style.height = '100%';
        this.equityCanvas = eqCanvas;
        equityWrap.appendChild(eqCanvas);

        // Drawdown canvas wrapper
        const ddWrap = document.createElement('div');
        ddWrap.style.flex = '1.5';
        ddWrap.style.position = 'relative';
        ddWrap.style.minHeight = '40px';
        chartArea.appendChild(ddWrap);

        const ddCanvas = document.createElement('canvas');
        ddCanvas.style.position = 'absolute';
        ddCanvas.style.left = '0';
        ddCanvas.style.top = '0';
        ddCanvas.style.width = '100%';
        ddCanvas.style.height = '100%';
        this.drawdownCanvas = ddCanvas;
        ddWrap.appendChild(ddCanvas);

        // Hover tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'pineorca-chart-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.display = 'none';
        tooltip.style.backgroundColor = 'rgba(30, 34, 45, 0.92)';
        tooltip.style.border = '1px solid #363a45';
        tooltip.style.borderRadius = '4px';
        tooltip.style.padding = '6px 8px';
        tooltip.style.fontSize = '11px';
        tooltip.style.color = '#d1d4dc';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.zIndex = '20';
        tooltip.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
        this.tooltipElement = tooltip;
        chartArea.appendChild(tooltip);

        // Pointer event listeners for crosshair
        const handlePointer = (e: MouseEvent) => {
            const rect = chartArea.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.handlePointerMove(x, rect.width);
        };
        chartArea.addEventListener('mousemove', handlePointer);
        chartArea.addEventListener('mouseleave', () => {
            this.hoveredIndex = null;
            if (this.tooltipElement) this.tooltipElement.style.display = 'none';
            this.renderCharts();
        });

        // ResizeObserver
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const { width, height } = entry.contentRect;
                    this.renderCharts(width, height);
                }
            });
            this.resizeObserver.observe(root);
        }

        this.container.appendChild(root);
    }

    private render(): void {
        this.renderKPIs();
        this.renderCharts();
    }

    private renderKPIs(): void {
        if (!this.kpiContainer) return;
        this.kpiContainer.innerHTML = '';

        const formatCurrency = (val: number) => {
            const sign = val >= 0 ? '+' : '';
            return `${sign}$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const createCard = (title: string, value: string, subValue: string, isPositive?: boolean | null) => {
            const card = document.createElement('div');
            card.style.backgroundColor = '#1e222d';
            card.style.border = '1px solid #2a2e39';
            card.style.borderRadius = '4px';
            card.style.padding = '8px 12px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '2px';

            const ttl = document.createElement('div');
            ttl.textContent = title;
            ttl.style.color = '#787b86';
            ttl.style.fontSize = '11px';
            card.appendChild(ttl);

            const val = document.createElement('div');
            val.textContent = value;
            val.style.fontSize = '16px';
            val.style.fontWeight = '600';
            if (isPositive === true) val.style.color = '#089981';
            else if (isPositive === false) val.style.color = '#f23645';
            else val.style.color = '#d1d4dc';
            card.appendChild(val);

            if (subValue) {
                const sub = document.createElement('div');
                sub.textContent = subValue;
                sub.style.fontSize = '11px';
                sub.style.color = isPositive === true ? '#089981' : isPositive === false ? '#f23645' : '#787b86';
                card.appendChild(sub);
            }

            return card;
        };

        const netPositive = this.metrics.netProfit > 0 ? true : this.metrics.netProfit < 0 ? false : null;
        this.kpiContainer.appendChild(
            createCard(
                'Net Profit',
                formatCurrency(this.metrics.netProfit),
                `${this.metrics.netProfitPercent >= 0 ? '+' : ''}${this.metrics.netProfitPercent.toFixed(2)}%`,
                netPositive
            )
        );

        this.kpiContainer.appendChild(
            createCard(
                'Profit Factor',
                this.metrics.profitFactor > 0 ? this.metrics.profitFactor.toFixed(2) : 'N/A',
                this.metrics.profitFactor >= 1.5 ? 'Strong' : this.metrics.profitFactor >= 1 ? 'Profitable' : 'Loss',
                this.metrics.profitFactor >= 1 ? true : this.metrics.profitFactor > 0 ? false : null
            )
        );

        this.kpiContainer.appendChild(
            createCard(
                'Win Rate',
                `${this.metrics.winRate.toFixed(1)}%`,
                this.metrics.totalTrades ? `${this.metrics.totalTrades} Total Trades` : '',
                this.metrics.winRate >= 50 ? true : false
            )
        );

        this.kpiContainer.appendChild(
            createCard(
                'Max Drawdown',
                formatCurrency(this.metrics.maxDrawdown),
                `${this.metrics.maxDrawdownPercent.toFixed(2)}%`,
                false
            )
        );
    }

    private handlePointerMove(x: number, containerWidth: number): void {
        if (!this.data.length || containerWidth <= 0) return;
        const leftPadding = 50;
        const rightPadding = 20;
        const plotWidth = containerWidth - leftPadding - rightPadding;
        if (plotWidth <= 0) return;

        const relX = Math.max(0, Math.min(plotWidth, x - leftPadding));
        const idx = Math.round((relX / plotWidth) * (this.data.length - 1));
        this.hoveredIndex = idx;

        const point = this.data[idx];
        if (point && this.tooltipElement) {
            const dateStr = new Date(point.time).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
            const eqVal = `$${point.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const bnhVal = point.buyAndHold != null ? `$${point.buyAndHold.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
            const ddVal = point.drawdownPercent != null ? `${point.drawdownPercent.toFixed(2)}%` : null;

            let html = `<div style="font-weight:600;margin-bottom:2px;">${dateStr}</div>`;
            html += `<div style="color:#2962ff;">Strategy: <b>${eqVal}</b></div>`;
            if (bnhVal) html += `<div style="color:#787b86;">Buy & Hold: <b>${bnhVal}</b></div>`;
            if (ddVal) html += `<div style="color:#f23645;">Drawdown: <b>${ddVal}</b></div>`;

            this.tooltipElement.innerHTML = html;
            this.tooltipElement.style.display = 'block';
            this.tooltipElement.style.left = `${Math.min(containerWidth - 140, Math.max(10, x + 10))}px`;
            this.tooltipElement.style.top = '10px';
        }

        this.renderCharts();
    }

    private renderCharts(w?: number, h?: number): void {
        if (!this.equityCanvas || !this.drawdownCanvas) return;

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

        // Render Equity Curve Canvas
        const eqRect = this.equityCanvas.parentElement?.getBoundingClientRect();
        const eqW = w ?? (eqRect?.width || 800);
        const eqH = eqRect?.height || 180;
        this.equityCanvas.width = Math.round(eqW * dpr);
        this.equityCanvas.height = Math.round(eqH * dpr);
        const eqCtx = this.equityCanvas.getContext('2d');
        if (eqCtx) {
            eqCtx.scale(dpr, dpr);
            this.drawEquityCurve(eqCtx, eqW, eqH);
        }

        // Render Underwater Drawdown Canvas
        const ddRect = this.drawdownCanvas.parentElement?.getBoundingClientRect();
        const ddW = w ?? (ddRect?.width || 800);
        const ddH = ddRect?.height || 90;
        this.drawdownCanvas.width = Math.round(ddW * dpr);
        this.drawdownCanvas.height = Math.round(ddH * dpr);
        const ddCtx = this.drawdownCanvas.getContext('2d');
        if (ddCtx) {
            ddCtx.scale(dpr, dpr);
            this.drawUnderwaterDrawdown(ddCtx, ddW, ddH);
        }
    }

    private drawEquityCurve(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        ctx.clearRect(0, 0, width, height);

        const left = 50;
        const right = width - 20;
        const top = 10;
        const bottom = height - 20;
        const plotW = right - left;
        const plotH = bottom - top;

        if (plotW <= 0 || plotH <= 0) return;

        // Grid lines
        ctx.strokeStyle = '#1e222d';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
            const y = top + (plotH / 4) * i;
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
        }
        ctx.stroke();

        if (this.data.length < 2) {
            ctx.fillStyle = '#787b86';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No trade equity history to display', width / 2, height / 2);
            return;
        }

        // Compute min / max
        let minVal = Infinity;
        let maxVal = -Infinity;
        for (const pt of this.data) {
            minVal = Math.min(minVal, pt.equity, pt.buyAndHold ?? pt.equity);
            maxVal = Math.max(maxVal, pt.equity, pt.buyAndHold ?? pt.equity);
        }
        if (minVal === maxVal) {
            minVal -= 1;
            maxVal += 1;
        }
        const valRange = maxVal - minVal;

        const getY = (val: number) => bottom - ((val - minVal) / valRange) * plotH;
        const getX = (idx: number) => left + (idx / (this.data.length - 1)) * plotW;

        // Draw Buy & Hold benchmark line if present
        if (this.data[0]?.buyAndHold != null) {
            ctx.save();
            ctx.strokeStyle = '#787b86';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            for (let i = 0; i < this.data.length; i++) {
                const x = getX(i);
                const y = getY(this.data[i]!.buyAndHold!);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.restore();
        }

        // Draw Strategy Equity gradient fill
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        gradient.addColorStop(0, 'rgba(41, 98, 255, 0.25)');
        gradient.addColorStop(1, 'rgba(41, 98, 255, 0.0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(getX(0), bottom);
        for (let i = 0; i < this.data.length; i++) {
            ctx.lineTo(getX(i), getY(this.data[i]!.equity));
        }
        ctx.lineTo(getX(this.data.length - 1), bottom);
        ctx.closePath();
        ctx.fill();

        // Draw Strategy Equity Line
        ctx.strokeStyle = '#2962ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < this.data.length; i++) {
            const x = getX(i);
            const y = getY(this.data[i]!.equity);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Crosshair if hovered
        if (this.hoveredIndex != null && this.hoveredIndex >= 0 && this.hoveredIndex < this.data.length) {
            const hX = getX(this.hoveredIndex);
            const hY = getY(this.data[this.hoveredIndex]!.equity);

            ctx.save();
            ctx.strokeStyle = '#505668';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(hX, top);
            ctx.lineTo(hX, bottom);
            ctx.stroke();
            ctx.restore();

            // Point circle
            ctx.fillStyle = '#2962ff';
            ctx.beginPath();
            ctx.arc(hX, hY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Y-Axis labels
        ctx.fillStyle = '#787b86';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`$${maxVal.toFixed(0)}`, left - 6, top + 10);
        ctx.fillText(`$${((maxVal + minVal) / 2).toFixed(0)}`, left - 6, top + plotH / 2 + 4);
        ctx.fillText(`$${minVal.toFixed(0)}`, left - 6, bottom);
    }

    private drawUnderwaterDrawdown(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        ctx.clearRect(0, 0, width, height);

        const left = 50;
        const right = width - 20;
        const top = 6;
        const bottom = height - 16;
        const plotW = right - left;
        const plotH = bottom - top;

        if (plotW <= 0 || plotH <= 0) return;

        if (this.data.length < 2) return;

        // Calculate drawdown series
        let peak = -Infinity;
        const drawdowns: number[] = [];
        let maxDd = 0;
        for (const pt of this.data) {
            if (pt.drawdownPercent != null) {
                drawdowns.push(pt.drawdownPercent);
                maxDd = Math.min(maxDd, pt.drawdownPercent);
            } else {
                if (pt.equity > peak) peak = pt.equity;
                const ddPct = peak > 0 ? ((pt.equity - peak) / peak) * 100 : 0;
                drawdowns.push(ddPct);
                maxDd = Math.min(maxDd, ddPct);
            }
        }

        const minDd = Math.min(-1, maxDd * 1.1); // e.g. -20%
        const getY = (dd: number) => top + (dd / minDd) * plotH;
        const getX = (idx: number) => left + (idx / (drawdowns.length - 1)) * plotW;

        // Zero line
        ctx.strokeStyle = '#2a2e39';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.stroke();

        // Gradient area
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        gradient.addColorStop(0, 'rgba(242, 54, 69, 0.4)');
        gradient.addColorStop(1, 'rgba(242, 54, 69, 0.05)');
        ctx.fillStyle = gradient;

        ctx.beginPath();
        ctx.moveTo(getX(0), top);
        for (let i = 0; i < drawdowns.length; i++) {
            ctx.lineTo(getX(i), getY(drawdowns[i]!));
        }
        ctx.lineTo(getX(drawdowns.length - 1), top);
        ctx.closePath();
        ctx.fill();

        // Drawdown line
        ctx.strokeStyle = '#f23645';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < drawdowns.length; i++) {
            const x = getX(i);
            const y = getY(drawdowns[i]!);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Crosshair sync
        if (this.hoveredIndex != null && this.hoveredIndex >= 0 && this.hoveredIndex < drawdowns.length) {
            const hX = getX(this.hoveredIndex);
            ctx.save();
            ctx.strokeStyle = '#505668';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(hX, top);
            ctx.lineTo(hX, bottom);
            ctx.stroke();
            ctx.restore();
        }

        // Labels
        ctx.fillStyle = '#787b86';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('0%', left - 6, top + 8);
        ctx.fillText(`${minDd.toFixed(1)}%`, left - 6, bottom);
    }
}
