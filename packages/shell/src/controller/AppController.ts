// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { WorkerBridge, type WorkerLike } from '@pineorca/worker-bridge';
import { PineOrcaWorkspace, type PineOrcaWorkspaceOptions, type TradeRowItem } from '@pineorca/ui';
import { VelaChartAdapter } from '@pineorca/chart';
import { ColumnarBarTable } from '@pineorca/data';
import { STRATEGY_PRESETS, type StrategyPreset } from '../presets/index.js';
import { getGoldenBarTable } from '../fixtures/golden-bars.js';
import { fetchBinanceKlines, fetchYahooKlines, subscribeBinanceLiveTicks } from '../market/market-client.js';

export interface AppControllerOptions {
  container?: HTMLElement | string;
  worker?: WorkerLike;
  workerFactory?: () => WorkerLike;
  barsCount?: number;
  initialPresetId?: string;
  monacoRuntime?: any;
}

/**
 * AppController: orchestrates the runnable PineOrca institutional shell.
 * Connects TopBar, Vela WebGL2 Chart, Monaco Editor, Strategy Tester,
 * WorkerBridge, and the 60Hz live streaming loop.
 */
export class AppController {
  private options: AppControllerOptions;
  private container: HTMLElement | null = null;

  private workspace: PineOrcaWorkspace | null = null;
  private chartAdapter: VelaChartAdapter | null = null;
  private workerBridge: WorkerBridge | null = null;

  private barsCount: number;
  private cachedBars: ColumnarBarTable | null = null;
  private currentRunId: string = 'run_init';
  private isRunning: boolean = false;
  private isStreamingActive: boolean = false;
  private streamingTimer: any = null;
  private lastStreamTime: number = 0;
  private lastStreamPrice: number = 30000;
  private currentProvider: 'golden' | 'binance' | 'yahoo' = 'golden';
  private currentSymbol: string = 'BTCUSDT';
  private currentTimeframe: string = '60';
  private liveWsCleanup: (() => void) | null = null;

  constructor(options: AppControllerOptions = {}) {
    this.options = options;
    this.barsCount = options.barsCount ?? 5000;
  }

  public async init(): Promise<void> {
    // 1. Resolve host container
    if (typeof this.options.container === 'string') {
      const el = typeof document !== 'undefined' ? document.querySelector(this.options.container) : null;
      this.container = (el as HTMLElement) ?? null;
    } else if (this.options.container) {
      this.container = this.options.container;
    } else if (typeof document !== 'undefined') {
      this.container = document.getElementById('app') ?? document.body;
    }

    if (!this.container) {
      throw new Error('AppController requires a valid container element');
    }

    // 2. Initialize isolated WorkerBridge
    if (this.options.worker) {
      this.workerBridge = new WorkerBridge({
        worker: this.options.worker,
        heartbeatIntervalMs: 0,
      });
    } else if (this.options.workerFactory) {
      this.workerBridge = new WorkerBridge({
        workerFactory: this.options.workerFactory,
        heartbeatIntervalMs: 0,
      });
    } else if (typeof Worker !== 'undefined') {
      const workerUrl = new URL('../worker/engine.worker.ts', import.meta.url);
      this.workerBridge = new WorkerBridge({
        workerFactory: () => new Worker(workerUrl, { type: 'module' }),
        heartbeatIntervalMs: 5000,
      });
      this.workerBridge.start();
    } else {
      // Headless fallback
      this.workerBridge = new WorkerBridge({ heartbeatIntervalMs: 0 });
    }

    // 3. Initialize Workspace
    const presetId = this.options.initialPresetId ?? 'sma_cross';
    const initialPreset = STRATEGY_PRESETS[presetId] ?? STRATEGY_PRESETS.sma_cross;

    const presetOptions = Object.entries(STRATEGY_PRESETS).map(([id, p]) => ({
      id,
      name: p.name,
    }));

    this.workspace = new PineOrcaWorkspace({
      topBar: {
        presets: presetOptions,
        initialPresetId: presetId,
        symbol: 'BINANCE:BTCUSDT',
        timeframe: '1h',
      },
      initialPineCode: initialPreset.code,
      monacoRuntime: this.options.monacoRuntime,
    });
    this.workspace.mount(this.container);

    // 4. Initialize Vela Chart Adapter
    this.chartAdapter = new VelaChartAdapter({
      container: this.workspace.getChartContainer(),
      theme: 'dark',
      symbol: 'BINANCE:BTCUSDT',
      timeframe: '1h',
    });

    // 5. Connect CrossProbeController with Chart
    this.workspace.getCrossProbeController().attachChart(this.chartAdapter);

    // 6. Connect TopBar events
    const topBar = this.workspace.getTopBar();
    topBar.onRunBacktest(() => {
      this.runBacktest();
    });

    topBar.onToggleStreaming((active: boolean) => {
      if (active) {
        this.startLiveStreaming();
      } else {
        this.stopLiveStreaming();
      }
    });

    topBar.onPresetChange((presetKey: string) => {
      const preset = STRATEGY_PRESETS[presetKey];
      if (preset && this.workspace) {
        this.workspace.getEditor().setCode(preset.code);
      }
    });
    topBar.onSymbolChange(async (rawSymbol: string) => {
      let provider: 'binance' | 'yahoo' | 'golden' = 'golden';
      let sym = rawSymbol;
      if (rawSymbol.startsWith('BINANCE:')) {
        provider = 'binance';
        sym = rawSymbol.replace(/^BINANCE:/, '');
      } else if (rawSymbol.startsWith('NASDAQ:') || rawSymbol.startsWith('FOREX:')) {
        provider = 'yahoo';
        sym = rawSymbol.replace(/^(NASDAQ|FOREX):/, '');
        if (rawSymbol === 'FOREX:EURUSD') sym = 'EURUSD=X';
      }
      await this.loadMarketData(provider, sym, topBar.getTimeframe());
    });

    topBar.onTimeframeChange(async (tf: string) => {
      await this.loadMarketData(this.currentProvider, this.currentSymbol, tf);
    });

    // 7. Connect Editor actions
    this.workspace.getEditor().onAction((action: string) => {
      if (action === 'updateStrategy' || action === 'addToChart') {
        this.runBacktest();
      }
    });

    // 8. Auto-load initial golden bars into cache
    this.cachedBars = getGoldenBarTable(this.barsCount);
    this.lastStreamTime = this.cachedBars.time[this.cachedBars.length - 1];
    this.lastStreamPrice = this.cachedBars.close[this.cachedBars.length - 1];
    if (this.chartAdapter) {
      await this.chartAdapter.setBars(this.cachedBars);
    }
  }

  public async runBacktest(): Promise<void> {
    if (this.isRunning || !this.workspace || !this.workerBridge) return;

    this.isRunning = true;
    const topBar = this.workspace.getTopBar();
    topBar.setStatus('running');

    try {
      if (!this.cachedBars) {
        this.cachedBars = getGoldenBarTable(this.barsCount);
        this.lastStreamTime = this.cachedBars.time[this.cachedBars.length - 1];
        this.lastStreamPrice = this.cachedBars.close[this.cachedBars.length - 1];
      }

      const code = this.workspace.getEditor().getCode();
      this.currentRunId = `run_${Date.now()}`;

      const result = await this.workerBridge.runBacktest({
        runId: this.currentRunId,
        source: code,
        symbol: topBar.getSymbol(),
        timeframe: topBar.getTimeframe(),
        bars: this.cachedBars,
        transferOwnership: false, // retain buffer copy for continuous runs
      });

      // Update TopBar
      topBar.setStatus('idle');
      topBar.setMetrics({
        durationMs: result.durationMs,
        totalBars: this.cachedBars.length,
        netProfitPercent: result.metrics.netProfitPercent,
        winRate: result.metrics.winRate,
      });

      // Update BottomDock summary
      this.workspace.getBottomDock().updateSummary({
        netProfit: result.metrics.netProfit,
        netProfitPercent: result.metrics.netProfitPercent,
        winRate: result.metrics.winRate,
        profitFactor: result.metrics.profitFactor,
        symbol: topBar.getSymbol(),
      });

      // Populate StrategyTester
      const eqLen = result.equityCurve.length;
      const step = Math.max(1, Math.floor(eqLen / 500));
      const equityPoints: Array<{ time: number; equity: number }> = [];

      for (let i = 0; i < eqLen; i += step) {
        equityPoints.push({
          time: this.cachedBars.time[i] ?? (1609459200000 + i * 3600_000),
          equity: result.equityCurve[i],
        });
      }
      if (equityPoints.length > 0 && equityPoints[equityPoints.length - 1].time !== this.cachedBars.time[eqLen - 1]) {
        equityPoints.push({
          time: this.cachedBars.time[eqLen - 1],
          equity: result.equityCurve[eqLen - 1],
        });
      }

      const tradeRows: TradeRowItem[] = (result.trades || []).map((t: any, idx: number) => {
        const side = (t.side === 'sell' || t.direction === 'short') ? ('sell' as const) : ('buy' as const);
        const kind = t.kind === 'exit' ? ('exit' as const) : ('entry' as const);
        const typeStr = side === 'buy'
          ? (kind === 'entry' ? ('Entry Long' as const) : ('Exit Long' as const))
          : (kind === 'entry' ? ('Entry Short' as const) : ('Exit Short' as const));

        return {
          tradeId: String(t.tradeId || t.id || `T${idx + 1}`),
          tradeIndex: idx + 1,
          type: typeStr,
          side,
          kind,
          signal: String(t.comment || t.label || t.signal || (kind === 'entry' ? 'Entry' : 'Exit')),
          time: Number(t.time || t.entry_time || t.entryTime || 0),
          price: Number(t.price || t.entry_price || t.entryPrice || 0),
          contracts: Number(t.qty || t.size || t.contracts || 1),
          profit: t.profit != null ? Number(t.profit) : undefined,
          profitPercent: t.profit_percent != null ? Number(t.profit_percent) : (t.profitPercent != null ? Number(t.profitPercent) : undefined),
        };
      });

      this.workspace.getStrategyTester().setResults({
        overviewMetrics: {
          netProfit: result.metrics.netProfit,
          netProfitPercent: result.metrics.netProfitPercent,
          profitFactor: result.metrics.profitFactor,
          totalTrades: result.metrics.totalTrades,
          winRate: result.metrics.winRate,
          maxDrawdown: result.metrics.maxDrawdown,
          maxDrawdownPercent: result.metrics.maxDrawdownPercent,
        },
        equityCurve: equityPoints,
        trades: tradeRows,
      });

      // Populate Chart Trade Markers
      if (this.chartAdapter) {
        const executions = (result.trades || []).map((t: any, idx: number) => ({
          tradeId: String(t.tradeId || t.id || `T${idx + 1}`),
          time: Number(t.time || t.entry_time || t.entryTime || 0),
          price: Number(t.price || t.entry_price || t.entryPrice || 0),
          side: (t.side === 'sell' || t.direction === 'short') ? ('sell' as const) : ('buy' as const),
          kind: (t.kind === 'exit') ? ('exit' as const) : ('entry' as const),
          qty: Number(t.qty || t.size || 1),
          label: t.comment || t.label || undefined,
        }));
        this.chartAdapter.setTrades(executions);
      }
    } catch (err: any) {
      topBar.setStatus('error', err?.message ?? String(err));
    } finally {
      this.isRunning = false;
    }
  }

  public startLiveStreaming(): void {
    if (this.isStreamingActive || !this.workspace || !this.workerBridge) return;

    this.isStreamingActive = true;
    const topBar = this.workspace.getTopBar();
    topBar.setStreaming(true);
    topBar.setStatus('streaming');

    if (this.currentProvider === 'binance') {
      this.liveWsCleanup = subscribeBinanceLiveTicks(
        this.currentSymbol,
        (tick) => {
          this.processStreamTick(tick.price, tick.time || Date.now(), tick.volume || 1);
        },
        (err) => {
          console.warn('[AppController] Binance WebSocket error:', err);
        }
      );
      return;
    }

    const intervalMs = 50; // ~20Hz updates
    this.streamingTimer = setInterval(async () => {
      if (!this.isStreamingActive || !this.workerBridge) return;

      const change = (Math.random() - 0.497) * 0.002 * this.lastStreamPrice;
      this.lastStreamPrice = Math.round((this.lastStreamPrice + change) * 100) / 100;
      this.lastStreamTime += 60_000;

      await this.processStreamTick(
        this.lastStreamPrice,
        this.lastStreamTime,
        Math.round(10 + Math.random() * 50)
      );
    }, intervalMs);
  }

  private async processStreamTick(price: number, time: number, volume: number): Promise<void> {
    if (!this.workerBridge) return;
    this.lastStreamPrice = price;
    this.lastStreamTime = time;

    try {
      const res = await this.workerBridge.streamTick({
        runId: this.currentRunId,
        time,
        price,
        volume,
        isBarClose: false,
      });

      if (res && res.bar && this.chartAdapter) {
        this.chartAdapter.updateCandle(res.bar);
      }
      if (res && res.metrics && this.workspace) {
        this.workspace.getTopBar().setMetrics({
          netProfitPercent: res.metrics.netProfitPercent,
          winRate: res.metrics.winRate,
        });
      }
    } catch {
      // Soft-catch streaming tick drop
    }
  }

  public async loadMarketData(
    providerName: 'golden' | 'binance' | 'yahoo',
    symbol: string = 'BTCUSDT',
    timeframe: string = '60',
    limit: number = 1000
  ): Promise<void> {
    this.currentProvider = providerName;
    this.currentSymbol = symbol;
    this.currentTimeframe = timeframe;

    if (providerName === 'golden') {
      this.cachedBars = getGoldenBarTable(this.barsCount);
    } else if (providerName === 'binance') {
      const table = await fetchBinanceKlines(symbol, timeframe, limit);
      if (table && table.length > 0) {
        this.cachedBars = table;
      } else {
        console.warn(`[AppController] Binance returned 0 bars for ${symbol} (${timeframe}), fallback to golden bars`);
        this.cachedBars = getGoldenBarTable(this.barsCount);
      }
    } else if (providerName === 'yahoo') {
      const table = await fetchYahooKlines(symbol, timeframe, limit);
      if (table && table.length > 0) {
        this.cachedBars = table;
      } else {
        console.warn(`[AppController] Yahoo returned 0 bars for ${symbol} (${timeframe}), fallback to golden bars`);
        this.cachedBars = getGoldenBarTable(this.barsCount);
      }
    }

    if (this.cachedBars && this.cachedBars.length > 0) {
      this.lastStreamTime = this.cachedBars.time[this.cachedBars.length - 1];
      this.lastStreamPrice = this.cachedBars.close[this.cachedBars.length - 1];

      if (this.chartAdapter) {
        await this.chartAdapter.setBars(this.cachedBars);
      }
    }
  }

  public stopLiveStreaming(): void {
    if (this.streamingTimer !== null) {
      clearInterval(this.streamingTimer);
      this.streamingTimer = null;
    }
    if (this.liveWsCleanup) {
      this.liveWsCleanup();
      this.liveWsCleanup = null;
    }
    this.isStreamingActive = false;

    if (this.workspace) {
      this.workspace.getTopBar().setStreaming(false);
      if (this.workspace.getTopBar().getStatus() === 'streaming') {
        this.workspace.getTopBar().setStatus('idle');
      }
    }
  }

  public destroy(): void {
    this.stopLiveStreaming();

    if (this.chartAdapter) {
      this.chartAdapter.destroy();
      this.chartAdapter = null;
    }
    if (this.workspace) {
      this.workspace.destroy();
      this.workspace = null;
    }
    if (this.workerBridge) {
      this.workerBridge.destroy();
      this.workerBridge = null;
    }

    this.cachedBars = null;
    this.container = null;
  }

  public getWorkspace(): PineOrcaWorkspace | null {
    return this.workspace;
  }

  public getChartAdapter(): VelaChartAdapter | null {
    return this.chartAdapter;
  }

  public getWorkerBridge(): WorkerBridge | null {
    return this.workerBridge;
  }
}
