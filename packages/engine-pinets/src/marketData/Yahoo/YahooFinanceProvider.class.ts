// SPDX-License-Identifier: AGPL-3.0-only

import { ISymbolInfo, BaseProviderConfig } from '../IProvider';
import { BaseProvider } from '../BaseProvider';
import { stripTickerModifier } from '../../tickerModifier';
import { Kline, INTERVAL_DURATION_MS } from '../types';

export interface YahooFinanceProviderConfig extends BaseProviderConfig {
    baseUrl?: string;
    userAgent?: string;
    cacheDurationMs?: number;
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

class CacheManager<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private readonly cacheDuration: number;

    constructor(cacheDuration: number = 5 * 60 * 1000) {
        this.cacheDuration = cacheDuration;
    }

    private generateKey(params: Record<string, any>): string {
        return Object.entries(params)
            .filter(([_, value]) => value !== undefined)
            .map(([key, value]) => `${key}:${value}`)
            .join('|');
    }

    get(params: Record<string, any>): T | null {
        const key = this.generateKey(params);
        const cached = this.cache.get(key);
        if (!cached) return null;
        if (Date.now() - cached.timestamp > this.cacheDuration) {
            this.cache.delete(key);
            return null;
        }
        return cached.data;
    }

    set(params: Record<string, any>, data: T): void {
        const key = this.generateKey(params);
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
        });
    }

    clear(): void {
        this.cache.clear();
    }
}

const TIMEFRAME_TO_YAHOO: Record<string, string> = {
    '1': '1m',
    '2': '2m',
    '5': '5m',
    '15': '15m',
    '30': '30m',
    '60': '60m',
    '90': '90m',
    '1h': '1h',
    'D': '1d',
    '1D': '1d',
    'W': '1wk',
    '1W': '1wk',
    'M': '1mo',
    '1M': '1mo',
};

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

export class YahooFinanceProvider extends BaseProvider<YahooFinanceProviderConfig> {
    private baseUrl: string = DEFAULT_BASE_URL;
    private userAgent: string = DEFAULT_USER_AGENT;
    private cacheManager: CacheManager<Kline[]>;
    private symbolInfoCache: Map<string, ISymbolInfo> = new Map();

    constructor(config?: YahooFinanceProviderConfig) {
        super({ requiresApiKey: false, providerName: 'Yahoo' });
        if (config?.baseUrl) this.baseUrl = config.baseUrl;
        if (config?.userAgent) this.userAgent = config.userAgent;
        this.cacheManager = new CacheManager<Kline[]>(config?.cacheDurationMs ?? 5 * 60 * 1000);
    }

    override configure(config: YahooFinanceProviderConfig): void {
        super.configure(config);
        if (config.baseUrl) this.baseUrl = config.baseUrl;
        if (config.userAgent) this.userAgent = config.userAgent;
        if (config.cacheDurationMs) {
            this.cacheManager = new CacheManager<Kline[]>(config.cacheDurationMs);
        }
    }

    protected override getSupportedTimeframes(): Set<string> {
        return new Set(['1', '2', '5', '15', '30', '60', '90', 'D', 'W', 'M']);
    }

    protected async _getMarketDataNative(
        tickerId: string,
        timeframe: string,
        limit?: number,
        sDate?: number,
        eDate?: number,
    ): Promise<Kline[]> {
        tickerId = stripTickerModifier(tickerId);
        const yahooInterval = TIMEFRAME_TO_YAHOO[timeframe.toUpperCase()] || TIMEFRAME_TO_YAHOO[timeframe];
        if (!yahooInterval) {
            console.error(`YahooFinanceProvider: Unsupported timeframe '${timeframe}'`);
            return [];
        }

        const cacheKey = { tickerId, timeframe, limit, sDate, eDate };
        const cached = this.cacheManager.get(cacheKey);
        if (cached) return cached;

        const nowSec = Math.floor(Date.now() / 1000);
        let period2 = eDate ? Math.floor(eDate / 1000) : nowSec;
        let period1: number;

        if (sDate) {
            period1 = Math.floor(sDate / 1000);
        } else if (limit) {
            const durationMs = INTERVAL_DURATION_MS[timeframe] || 86400000;
            const durationSec = Math.floor(durationMs / 1000);
            period1 = Math.max(0, period2 - limit * durationSec);
        } else {
            // Default 30 days
            period1 = Math.max(0, period2 - 30 * 86400);
        }

        const url = `${this.baseUrl}/${encodeURIComponent(tickerId)}?period1=${period1}&period2=${period2}&interval=${yahooInterval}&includePrePost=false&events=div%2Csplits`;

        try {
            const headers: Record<string, string> = {
                'User-Agent': this.userAgent,
                Accept: 'application/json',
            };

            const response = await fetch(url, { headers });
            if (!response.ok) {
                console.error(`YahooFinanceProvider: HTTP ${response.status} from ${url}`);
                return [];
            }

            const data = await response.json();
            const result = data?.chart?.result?.[0];
            if (!result) {
                if (data?.chart?.error) {
                    console.error('YahooFinanceProvider error:', data.chart.error);
                }
                return [];
            }

            const timestamps: number[] = result.timestamp || [];
            const quote = result.indicators?.quote?.[0];
            if (!quote || timestamps.length === 0) return [];

            const opens = quote.open || [];
            const highs = quote.high || [];
            const lows = quote.low || [];
            const closes = quote.close || [];
            const volumes = quote.volume || [];

            const durationMs = INTERVAL_DURATION_MS[timeframe] || 86400000;
            const klines: Kline[] = [];

            for (let i = 0; i < timestamps.length; i++) {
                const o = opens[i];
                const h = highs[i];
                const l = lows[i];
                const c = closes[i];
                const v = volumes[i];

                // Skip null / incomplete bars (e.g. non-trading periods)
                if (o == null || h == null || l == null || c == null) {
                    continue;
                }

                const openTime = timestamps[i] * 1000;
                klines.push({
                    openTime,
                    open: Number(o),
                    high: Number(h),
                    low: Number(l),
                    close: Number(c),
                    volume: v != null ? Number(v) : 0,
                    closeTime: openTime + durationMs - 1,
                    quoteAssetVolume: 0,
                    numberOfTrades: 0,
                    takerBuyBaseAssetVolume: 0,
                    takerBuyQuoteAssetVolume: 0,
                    ignore: 0,
                });
            }

            this.normalizeCloseTime(klines);

            const finalKlines = limit && klines.length > limit ? klines.slice(-limit) : klines;
            this.cacheManager.set(cacheKey, finalKlines);

            return finalKlines;
        } catch (error) {
            console.error(`YahooFinanceProvider error fetching ${tickerId}:`, error);
            return [];
        }
    }

    async getSymbolInfo(tickerId: string): Promise<ISymbolInfo> {
        tickerId = stripTickerModifier(tickerId);
        if (this.symbolInfoCache.has(tickerId)) {
            return this.symbolInfoCache.get(tickerId)!;
        }

        const url = `${this.baseUrl}/${encodeURIComponent(tickerId)}?interval=1d&range=1d`;
        let meta: any = null;

        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
            });
            if (response.ok) {
                const data = await response.json();
                meta = data?.chart?.result?.[0]?.meta;
            }
        } catch (err) {
            console.warn(`YahooFinanceProvider: failed to fetch symbol meta for ${tickerId}`, err);
        }

        const symbolInfo: ISymbolInfo = {
            current_contract: '',
            description: meta?.longName || meta?.shortName || tickerId,
            isin: '',
            main_tickerid: tickerId,
            prefix: meta?.exchangeName || '',
            root: tickerId,
            ticker: meta?.symbol || tickerId,
            tickerid: tickerId,
            type: meta?.instrumentType?.toLowerCase() || 'stock',
            basecurrency: meta?.currency || 'USD',
            country: '',
            currency: meta?.currency || 'USD',
            timezone: meta?.exchangeTimezoneName || 'America/New_York',
            employees: 0,
            industry: '',
            sector: '',
            shareholders: 0,
            shares_outstanding_float: 0,
            shares_outstanding_total: 0,
            expiration_date: 0,
            session: '24x7',
            volumetype: 'base',
            mincontract: 1,
            minmove: 1,
            mintick: meta?.priceHint ? Math.pow(10, -meta.priceHint) : 0.01,
            pointvalue: 1,
            pricescale: meta?.priceHint ? Math.pow(10, meta.priceHint) : 100,
            recommendations_buy: 0,
            recommendations_buy_strong: 0,
            recommendations_date: 0,
            recommendations_hold: 0,
            recommendations_sell: 0,
            recommendations_sell_strong: 0,
            recommendations_total: 0,
            target_price_average: 0,
            target_price_date: 0,
            target_price_estimates: 0,
            target_price_high: 0,
            target_price_low: 0,
            target_price_median: 0,
        };
        this.symbolInfoCache.set(tickerId, symbolInfo);
        return symbolInfo;
    }
}
