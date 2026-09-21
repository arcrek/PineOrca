// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export type TopBarStatus = 'idle' | 'running' | 'streaming' | 'error' | 'cancelled';

export interface StrategyPresetOption {
  id: string;
  name: string;
}

export interface TopBarMetrics {
  durationMs?: number;
  totalBars?: number;
  netProfitPercent?: number;
  winRate?: number;
}

export interface TopBarOptions {
  symbol?: string;
  symbols?: string[];
  timeframe?: string;
  timeframes?: string[];
  presets?: StrategyPresetOption[];
  initialPresetId?: string;
  initialStreaming?: boolean;
}

export type RunBacktestCallback = () => void;
export type ToggleStreamingCallback = (active: boolean) => void;
export type SymbolChangeCallback = (symbol: string) => void;
export type TimeframeChangeCallback = (timeframe: string) => void;
export type PresetChangeCallback = (presetId: string) => void;

/**
 * TopBar: institutional dark-theme control header with symbol, timeframe,
 * strategy presets, backtest execution button, live stream toggle, and telemetry badge.
 */
export class TopBar {
  private container: HTMLElement | null = null;
  private rootElement: HTMLElement | null = null;

  private symbolSelect: HTMLSelectElement | null = null;
  private timeframeGroup: HTMLElement | null = null;
  private presetSelect: HTMLSelectElement | null = null;
  private runButton: HTMLButtonElement | null = null;
  private streamButton: HTMLButtonElement | null = null;
  private statusBadge: HTMLElement | null = null;
  private metricsBadge: HTMLElement | null = null;

  private currentSymbol: string;
  private currentTimeframe: string;
  private currentPresetId: string;
  private isStreamingActive: boolean;
  private currentStatus: TopBarStatus = 'idle';
  private currentMeta: string = '';

  private readonly symbols: string[];
  private readonly timeframes: string[];
  private readonly presets: StrategyPresetOption[];

  private runListeners = new Set<RunBacktestCallback>();
  private streamListeners = new Set<ToggleStreamingCallback>();
  private symbolListeners = new Set<SymbolChangeCallback>();
  private timeframeListeners = new Set<TimeframeChangeCallback>();
  private presetListeners = new Set<PresetChangeCallback>();

  constructor(options: TopBarOptions = {}) {
    this.symbols = options.symbols ?? [
      'BINANCE:BTCUSDT',
      'BINANCE:ETHUSDT',
      'NASDAQ:AAPL',
      'NASDAQ:NVDA',
      'FOREX:EURUSD',
    ];
    this.timeframes = options.timeframes ?? ['1m', '5m', '15m', '1h', '4h', '1D'];
    this.presets = options.presets ?? [
      { id: 'sma_cross', name: 'SMA Cross (Fast/Slow)' },
      { id: 'rsi_divergence', name: 'RSI Reversal' },
      { id: 'bollinger_breakout', name: 'Bollinger Breakout' },
      { id: 'macd_trend', name: 'MACD Momentum' },
    ];

    this.currentSymbol = options.symbol ?? this.symbols[0];
    this.currentTimeframe = options.timeframe ?? '1m';
    this.currentPresetId = options.initialPresetId ?? this.presets[0].id;
    this.isStreamingActive = options.initialStreaming ?? false;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.buildDOM();
    this.updateUI();
  }

  public destroy(): void {
    if (this.rootElement && this.rootElement.parentNode) {
      this.rootElement.parentNode.removeChild(this.rootElement);
    }
    this.rootElement = null;
    this.container = null;
    this.runListeners.clear();
    this.streamListeners.clear();
    this.symbolListeners.clear();
    this.timeframeListeners.clear();
    this.presetListeners.clear();
  }

  public getElement(): HTMLElement | null {
    return this.rootElement;
  }

  public getSymbol(): string {
    return this.currentSymbol;
  }

  public getTimeframe(): string {
    return this.currentTimeframe;
  }

  public getPreset(): string {
    return this.currentPresetId;
  }

  public getStatus(): TopBarStatus {
    return this.currentStatus;
  }

  public getMeta(): string {
    return this.currentMeta;
  }

  public isStreaming(): boolean {
    return this.isStreamingActive;
  }

  public setSymbol(symbol: string): void {
    this.currentSymbol = symbol;
    if (this.symbolSelect) {
      this.symbolSelect.value = symbol;
    }
  }

  public setTimeframe(timeframe: string): void {
    this.currentTimeframe = timeframe;
    this.renderTimeframes();
  }

  public setPreset(presetId: string): void {
    this.currentPresetId = presetId;
    if (this.presetSelect) {
      this.presetSelect.value = presetId;
    }
  }

  public setStatus(status: TopBarStatus, meta?: string): void {
    this.currentStatus = status;
    this.currentMeta = meta ?? '';
    this.updateStatusBadge();
    this.updateRunButton();
  }

  public setMetrics(metrics: TopBarMetrics): void {
    if (!this.metricsBadge) return;
    const parts: string[] = [];
    if (metrics.durationMs !== undefined) {
      parts.push(`${metrics.durationMs.toFixed(1)}ms`);
    }
    if (metrics.totalBars !== undefined) {
      parts.push(`${metrics.totalBars.toLocaleString()} bars`);
    }
    if (metrics.netProfitPercent !== undefined) {
      const sign = metrics.netProfitPercent >= 0 ? '+' : '';
      parts.push(`P&L: ${sign}${metrics.netProfitPercent.toFixed(2)}%`);
    }
    if (metrics.winRate !== undefined) {
      parts.push(`Win: ${metrics.winRate.toFixed(1)}%`);
    }

    if (parts.length > 0) {
      this.metricsBadge.textContent = parts.join(' | ');
      this.metricsBadge.style.display = 'inline-flex';
    } else {
      this.metricsBadge.style.display = 'none';
    }
  }

  public setStreaming(isStreaming: boolean): void {
    this.isStreamingActive = isStreaming;
    this.updateStreamButton();
  }

  public onRunBacktest(cb: RunBacktestCallback): () => void {
    this.runListeners.add(cb);
    return () => this.runListeners.delete(cb);
  }

  public onToggleStreaming(cb: ToggleStreamingCallback): () => void {
    this.streamListeners.add(cb);
    return () => this.streamListeners.delete(cb);
  }

  public onSymbolChange(cb: SymbolChangeCallback): () => void {
    this.symbolListeners.add(cb);
    return () => this.symbolListeners.delete(cb);
  }

  public onTimeframeChange(cb: TimeframeChangeCallback): () => void {
    this.timeframeListeners.add(cb);
    return () => this.timeframeListeners.delete(cb);
  }

  public onPresetChange(cb: PresetChangeCallback): () => void {
    this.presetListeners.add(cb);
    return () => this.presetListeners.delete(cb);
  }

  private buildDOM(): void {
    const root = document.createElement('header');
    root.className = 'pineorca-topbar';
    root.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      padding: 0 12px;
      background-color: #131722;
      border-bottom: 1px solid #2a2e39;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
      font-size: 13px;
      color: #d1d4dc;
      user-select: none;
      z-index: 100;
      flex-shrink: 0;
    `;

    // LEFT SECTION: Brand, Symbol, Timeframe, Preset
    const leftSection = document.createElement('div');
    leftSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    // Brand Logo
    const brand = document.createElement('div');
    brand.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      color: #ffffff;
      font-size: 14px;
      letter-spacing: -0.2px;
    `;
    brand.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2962ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
        <polyline points="16 7 22 7 22 13"></polyline>
      </svg>
      <span>PineOrca</span>
    `;
    leftSection.appendChild(brand);

    // Separator
    leftSection.appendChild(this.createSeparator());

    // Symbol Selector
    this.symbolSelect = document.createElement('select');
    this.symbolSelect.className = 'topbar-symbol-select';
    this.symbolSelect.style.cssText = `
      background-color: #1e222d;
      border: 1px solid #2a2e39;
      border-radius: 4px;
      color: #f0f3fa;
      font-weight: 600;
      font-size: 12px;
      padding: 4px 8px;
      cursor: pointer;
      outline: none;
    `;
    for (const sym of this.symbols) {
      const opt = document.createElement('option');
      opt.value = sym;
      opt.textContent = sym;
      if (sym === this.currentSymbol) opt.selected = true;
      this.symbolSelect.appendChild(opt);
    }
    this.symbolSelect.addEventListener('change', () => {
      this.currentSymbol = this.symbolSelect!.value;
      for (const listener of this.symbolListeners) {
        listener(this.currentSymbol);
      }
    });
    leftSection.appendChild(this.symbolSelect);

    // Timeframe Buttons
    this.timeframeGroup = document.createElement('div');
    this.timeframeGroup.className = 'topbar-timeframe-group';
    this.timeframeGroup.style.cssText = `
      display: flex;
      align-items: center;
      background-color: #1e222d;
      border-radius: 4px;
      border: 1px solid #2a2e39;
      overflow: hidden;
    `;
    this.renderTimeframes();
    leftSection.appendChild(this.timeframeGroup);

    // Separator
    leftSection.appendChild(this.createSeparator());

    // Strategy Preset Selector
    const presetWrapper = document.createElement('div');
    presetWrapper.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    const presetLabel = document.createElement('span');
    presetLabel.textContent = 'Strategy:';
    presetLabel.style.cssText = 'color: #787b86; font-size: 11px; font-weight: 500;';
    presetWrapper.appendChild(presetLabel);

    this.presetSelect = document.createElement('select');
    this.presetSelect.className = 'topbar-preset-select';
    this.presetSelect.style.cssText = `
      background-color: #1e222d;
      border: 1px solid #2a2e39;
      border-radius: 4px;
      color: #d1d4dc;
      font-size: 12px;
      padding: 4px 8px;
      cursor: pointer;
      outline: none;
    `;
    for (const p of this.presets) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === this.currentPresetId) opt.selected = true;
      this.presetSelect.appendChild(opt);
    }
    this.presetSelect.addEventListener('change', () => {
      this.currentPresetId = this.presetSelect!.value;
      for (const listener of this.presetListeners) {
        listener(this.currentPresetId);
      }
    });
    presetWrapper.appendChild(this.presetSelect);
    leftSection.appendChild(presetWrapper);

    root.appendChild(leftSection);

    // RIGHT SECTION: Telemetry, Streaming Toggle, Run Button
    const rightSection = document.createElement('div');
    rightSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    // Metrics Badge
    this.metricsBadge = document.createElement('div');
    this.metricsBadge.className = 'topbar-metrics-badge';
    this.metricsBadge.style.cssText = `
      display: none;
      align-items: center;
      padding: 4px 8px;
      background-color: #1e222d;
      border: 1px solid #2a2e39;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      color: #787b86;
    `;
    rightSection.appendChild(this.metricsBadge);

    // Status Badge
    this.statusBadge = document.createElement('div');
    this.statusBadge.className = 'topbar-status-badge';
    this.statusBadge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      background-color: rgba(120, 123, 134, 0.15);
      color: #787b86;
    `;
    rightSection.appendChild(this.statusBadge);

    // Live Stream Toggle Button
    this.streamButton = document.createElement('button');
    this.streamButton.className = 'topbar-stream-button';
    this.streamButton.type = 'button';
    this.streamButton.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      transition: all 0.15s ease;
    `;
    this.streamButton.addEventListener('click', () => {
      this.isStreamingActive = !this.isStreamingActive;
      this.updateStreamButton();
      for (const listener of this.streamListeners) {
        listener(this.isStreamingActive);
      }
    });
    rightSection.appendChild(this.streamButton);

    // Run Backtest Button
    this.runButton = document.createElement('button');
    this.runButton.className = 'topbar-run-button';
    this.runButton.type = 'button';
    this.runButton.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background-color: #2962ff;
      color: #ffffff;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      outline: none;
      transition: background-color 0.15s ease, opacity 0.15s ease;
    `;
    this.runButton.addEventListener('mouseover', () => {
      if (this.currentStatus !== 'running') {
        this.runButton!.style.backgroundColor = '#1e53e5';
      }
    });
    this.runButton.addEventListener('mouseout', () => {
      if (this.currentStatus !== 'running') {
        this.runButton!.style.backgroundColor = '#2962ff';
      }
    });
    this.runButton.addEventListener('click', () => {
      if (this.currentStatus === 'running') return;
      for (const listener of this.runListeners) {
        listener();
      }
    });
    rightSection.appendChild(this.runButton);

    root.appendChild(rightSection);

    this.rootElement = root;
    this.container?.appendChild(root);
  }

  private renderTimeframes(): void {
    if (!this.timeframeGroup) return;
    this.timeframeGroup.innerHTML = '';

    for (const tf of this.timeframes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = tf;
      const isActive = tf === this.currentTimeframe;
      btn.style.cssText = `
        padding: 4px 8px;
        background-color: ${isActive ? '#2962ff' : 'transparent'};
        color: ${isActive ? '#ffffff' : '#787b86'};
        border: none;
        font-size: 11px;
        font-weight: ${isActive ? '600' : '500'};
        cursor: pointer;
        outline: none;
        transition: all 0.1s ease;
      `;
      btn.addEventListener('click', () => {
        this.currentTimeframe = tf;
        this.renderTimeframes();
        for (const listener of this.timeframeListeners) {
          listener(tf);
        }
      });
      this.timeframeGroup.appendChild(btn);
    }
  }

  private updateUI(): void {
    this.updateStatusBadge();
    this.updateRunButton();
    this.updateStreamButton();
  }

  private updateStatusBadge(): void {
    if (!this.statusBadge) return;

    let bg = 'rgba(120, 123, 134, 0.15)';
    let color = '#787b86';
    let text = 'IDLE';

    switch (this.currentStatus) {
      case 'idle':
        text = 'IDLE';
        bg = 'rgba(120, 123, 134, 0.15)';
        color = '#787b86';
        break;
      case 'running':
        text = 'RUNNING';
        bg = 'rgba(41, 98, 255, 0.2)';
        color = '#2962ff';
        break;
      case 'streaming':
        text = 'STREAMING';
        bg = 'rgba(8, 153, 129, 0.2)';
        color = '#089981';
        break;
      case 'error':
        text = this.currentMeta ? `ERROR: ${this.currentMeta}` : 'ERROR';
        bg = 'rgba(242, 54, 69, 0.2)';
        color = '#f23645';
        break;
      case 'cancelled':
        text = 'CANCELLED';
        bg = 'rgba(255, 152, 0, 0.2)';
        color = '#ff9800';
        break;
    }

    this.statusBadge.style.backgroundColor = bg;
    this.statusBadge.style.color = color;
    this.statusBadge.textContent = text;
  }

  private updateRunButton(): void {
    if (!this.runButton) return;
    const isRunning = this.currentStatus === 'running';

    if (isRunning) {
      this.runButton.disabled = true;
      this.runButton.style.opacity = '0.7';
      this.runButton.style.cursor = 'not-allowed';
      this.runButton.style.backgroundColor = '#1e222d';
      this.runButton.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="topbar-spinner" style="animation: topbar-spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke-dasharray="30" stroke-dashoffset="10"></circle>
        </svg>
        <span>Running...</span>
      `;
    } else {
      this.runButton.disabled = false;
      this.runButton.style.opacity = '1';
      this.runButton.style.cursor = 'pointer';
      this.runButton.style.backgroundColor = '#2962ff';
      this.runButton.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>Run Backtest</span>
      `;
    }
  }

  private updateStreamButton(): void {
    if (!this.streamButton) return;

    if (this.isStreamingActive) {
      this.streamButton.style.backgroundColor = 'rgba(8, 153, 129, 0.15)';
      this.streamButton.style.border = '1px solid #089981';
      this.streamButton.style.color = '#089981';
      this.streamButton.innerHTML = `
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #089981; box-shadow: 0 0 6px #089981;"></span>
        <span>Streaming</span>
      `;
    } else {
      this.streamButton.style.backgroundColor = '#1e222d';
      this.streamButton.style.border = '1px solid #2a2e39';
      this.streamButton.style.color = '#787b86';
      this.streamButton.innerHTML = `
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #787b86;"></span>
        <span>Live Stream</span>
      `;
    }
  }

  private createSeparator(): HTMLElement {
    const sep = document.createElement('div');
    sep.style.cssText = 'width: 1px; height: 18px; background-color: #2a2e39;';
    return sep;
  }
}
