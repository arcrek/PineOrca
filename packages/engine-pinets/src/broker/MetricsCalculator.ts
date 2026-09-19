// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { StrategyState, Trade } from '../namespaces/strategy/types';
import { Series } from '../Series';
import { ledgerOpenLots } from './FIFOLedger';



/**
 * Mark-to-market the open positions to `currentPrice`, updating
 * `strategy.openprofit` and `strategy.equity`. Does NOT touch the
 * max_drawdown / max_runup peaks — those are latched once per bar by
 * `updateEquityPeaks` AFTER all entry+exit fills have settled, so that
 * trades closed mid-bar by TP / SL are reflected as realized P&L (rather
 * than as a phantom intra-bar excursion against the bar's raw H/L).
 */
export function markToMarket(context: any, currentPrice: number): void {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let unrealizedPnL = 0;
    for (const lot of ledgerOpenLots(strategy)) {
        const priceChange = lot.dir === 1 ? currentPrice - lot.entry_price : lot.entry_price - currentPrice;
        unrealizedPnL += priceChange * lot.qty * pointValue;
    }
    strategy.openprofit = unrealizedPnL;
    strategy.equity = strategy.initial_capital + strategy.netprofit + unrealizedPnL;
}


/**
 * Latch `strategy.max_drawdown` and `strategy.max_runup` using INTRA-BAR
 * high/low excursions of the CURRENT open position (after all fills have
 * settled for the bar).
 *
 * Algorithm:
 *   1. `equity_peak` / `equity_trough` track the running high/low of
 *      REALIZED equity (initial_capital + netprofit). They step only on
 *      closed-trade P&L.
 *   2. For the still-open position (single weighted-avg via position_size /
 *      position_avg_price), compute worst- and best-case unrealized excursion
 *      against the bar's adverse / favorable extreme:
 *        long:  worstPrice = low,   bestPrice = high
 *        short: worstPrice = high,  bestPrice = low
 *   3. drawdown_this_bar = (equity_peak  − realized_equity) + worst_excursion
 *      runup_this_bar    = (realized_equity − equity_trough) + best_excursion
 *   4. Latch the running maxima.
 *
 * Why latch only after fills: a trade closed by TP / SL during the bar
 * realizes exactly its stop/target P&L. Computing drawdown against the bar's
 * raw low BEFORE the fill would overcount — the trade never actually marked
 * to that low because the stop fired first. Running this only after fills
 * means closed trades contribute via `realizedEquity` (their actual close
 * price), and only positions that survived the bar contribute via H/L.
 *
 * Per-trade excursions (trade.max_drawdown / trade.max_runup) are tracked
 * separately at the top of processStrategyOrders against the same bar H/L.
 */
export function updateEquityPeaks(context: any, highPrice: number, lowPrice: number): void {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;

    const realizedEquity = strategy.initial_capital + strategy.netprofit;

    // Open-book entry commissions (already deducted from netprofit at
    // fill) — LEDGER view, consistent with netprofit's slice increments.
    let openCommission = 0;
    for (const lot of ledgerOpenLots(strategy)) openCommission += lot.commission;

    // PEAK basis excludes the open trades' entry commissions. TV latches the
    // equity high-water on the intermediate funds state right after a close
    // settles — BEFORE the entry commission of a trade opened on the same
    // bar (reversal) is charged. PT processes the reversal close+open
    // atomically, so the peak basis adds the open entry commissions back.
    // Verified against QA margin_calls xlsx (1% percent commission): TV's
    // peak was exactly closed-trades-cum (+148,279.33) while the reversal
    // trade opened on the peak bar had already cost 2,483.81 in entry
    // commission. The TROUGH basis keeps the commission deducted
    // (pessimistic on both sides — matches TV's run-up line exactly).
    const peakBasis = realizedEquity + openCommission;
    if (peakBasis > strategy.equity_peak) strategy.equity_peak = peakBasis;
    if (realizedEquity < strategy.equity_trough) strategy.equity_trough = realizedEquity;

    const posSize = strategy.position_size;
    const avgPrice = strategy.position_avg_price;

    let worstExcursion = 0;
    let bestExcursion = 0;
    if (posSize !== 0 && Number.isFinite(avgPrice)) {
        const worstPrice = posSize > 0 ? lowPrice : highPrice;
        const bestPrice = posSize > 0 ? highPrice : lowPrice;
        // posSize * (avg - worstPrice) is always >= 0 (a loss); same for gain.
        // Multiplied by pointValue to convert price units → account currency.
        worstExcursion = posSize * (avgPrice - worstPrice) * pointValue;
        bestExcursion = posSize * (bestPrice - avgPrice) * pointValue;
    }

    // Drawdown = realized gap from the high-water + the open position's
    // intra-bar adverse excursion. No commission correction here: the peak
    // basis already excludes open entry commissions (see above) while
    // realizedEquity includes them — the asymmetry IS TV's model.
    const drawDown = strategy.equity_peak - realizedEquity + worstExcursion;
    if (drawDown > strategy.max_drawdown) {
        strategy.max_drawdown = drawDown;
        // Snapshot Max_Equity (the realized high-water in force at this
        // moment) — denominator for max_drawdown_percent. Per TV's docs:
        //   ddpct = max_drawdown / Max_Equity-at-latch × 100
        strategy.equity_at_drawdown_peak = strategy.equity_peak;

        // TV's max_drawdown_percent is the RUNNING MAX of the per-latch
        // ratio, not (current_max_drawdown / current_equity_at_peak).
        // The two diverge when a later latch has a larger absolute
        // drawdown but a smaller percentage (equity grew faster). Track
        // the high-water ratio independently of the absolute peak.
        if (strategy.equity_peak > 0) {
            const ratio = (100 * drawDown) / strategy.equity_peak;
            if (ratio > strategy.max_drawdown_percent_value) {
                strategy.max_drawdown_percent_value = ratio;
            }
        }
    }

    const runUp = realizedEquity - strategy.equity_trough + bestExcursion;
    if (runUp > strategy.max_runup) {
        strategy.max_runup = runUp;
        // Snapshot the total equity at this peak — denominator for max_runup_percent.
        strategy.equity_at_runup_peak = realizedEquity + bestExcursion;

        // Symmetric running-max-of-ratio for max_runup_percent. See the
        // max_drawdown_percent comment above for the semantic reason.
        if (strategy.equity_at_runup_peak > 0) {
            const ratio = (100 * runUp) / strategy.equity_at_runup_peak;
            if (ratio > strategy.max_runup_percent_value) {
                strategy.max_runup_percent_value = ratio;
            }
        }
    }
}


/**
 * End-of-bar finalize: refresh equity at CLOSE and latch
 * `strategy.max_drawdown` / `strategy.max_runup` using the bar's H/L. Runs
 * UNCONDITIONALLY once per bar (after entry+exit fills are done), regardless
 * of whether the strategy uses exit orders.
 */
export function finalizeStrategyBar(context: any): void {
    if (!context.strategy) return;
    const strategy: StrategyState = context.strategy;
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const closePrice = Series.from(context.data.close).get(0);
    markToMarket(context, closePrice);
    updateEquityPeaks(context, highPrice, lowPrice);

    // Record the MARK-TO-MARKET equity at each calendar month's last bar,
    // for the end-of-run Sharpe / Sortino ratios (see
    // finalizeStrategyRun). TV samples the equity curve monthly regardless
    // of the chart timeframe; we keep the last bar's equity per UTC
    // calendar month (overwrite within a month, append on rollover).
    const barTime = Series.from(context.data.openTime).get(0);
    if (Number.isFinite(barTime)) {
        const d = new Date(barTime);
        const monthKey = d.getUTCFullYear() * 12 + d.getUTCMonth();
        const series = (strategy._monthly_equity ??= []);
        if (strategy._last_month_key === monthKey && series.length > 0) {
            series[series.length - 1] = strategy.equity;
        } else {
            series.push(strategy.equity);
            strategy._last_month_key = monthKey;
        }
    }
}


/**
 * End-of-run finalize: compute the risk-adjusted performance ratios
 * (Sharpe / Sortino) from the monthly equity curve captured during the
 * run. Called ONCE after the last bar (see PineTS.class.ts).
 *
 * TV broker-emulator formula (confirmed against the Help Center docs and
 * reverse-engineered to the third decimal across 7 QA datasets,
 * 2026-06-15):
 *   - Sample the MARK-TO-MARKET equity at each calendar month's close.
 *   - Monthly simple returns rᵢ = Eᵢ / Eᵢ₋₁ − 1, anchored at the initial
 *     capital (the first return runs from initial_capital to month 1).
 *   - MR = mean(rᵢ);  RFR = risk_free_rate / 100 / 12 (annual % → monthly).
 *   - Sharpe  = (MR − RFR) / SD,  SD = √(Σ(rᵢ − MR)² / N)   (population).
 *   - Sortino = (MR − RFR) / DD,  DD = √(Σ min(0, rᵢ − RFR)² / N)
 *     (downside deviation over ALL N returns, target = RFR — per TV's
 *     documented DD = sqrt(sum(min(0, Xᵢ − T))² / N)).
 *   - No annualization.
 *
 * Note: the ratios are only as accurate as the bar-by-bar equity path;
 * they ride on the strategy engine's mark-to-market fidelity. With < 2
 * monthly returns (very short backtests) they are left at 0.
 */
export function finalizeStrategyRun(context: any): void {
    const strategy: StrategyState = context?.strategy;
    if (!strategy) return;

    // CAGR is independent of the monthly equity curve (it only needs the
    // first/last bar times and the realized P&L), so compute it before the
    // Sharpe / Sortino short-circuit below.
    strategy.cagr = computeCagr(context);

    // Buy-and-hold benchmark (independent of the monthly equity curve too).
    computeBuyAndHold(context);

    const series = strategy._monthly_equity ?? [];
    const equities = [strategy.initial_capital, ...series];
    const returns: number[] = [];
    for (let i = 1; i < equities.length; i++) {
        const prev = equities[i - 1];
        if (prev !== 0 && Number.isFinite(prev) && Number.isFinite(equities[i])) {
            returns.push(equities[i] / prev - 1);
        }
    }

    if (returns.length < 2) {
        strategy.sharpe_ratio = 0;
        strategy.sortino_ratio = 0;
        return;
    }

    const rfrMonthly = (strategy.config.risk_free_rate ?? 2) / 100 / 12;
    const n = returns.length;
    const mean = returns.reduce((s, r) => s + r, 0) / n;
    const excess = mean - rfrMonthly;

    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);

    const downsideSq = returns.reduce((s, r) => s + Math.min(0, r - rfrMonthly) ** 2, 0) / n;
    const dd = Math.sqrt(downsideSq);

    strategy.sharpe_ratio = sd > 0 ? excess / sd : 0;
    strategy.sortino_ratio = dd > 0 ? excess / dd : 0;
}


/**
 * Compound Annual Growth Rate (%) of strategy equity over the full backtest
 * window. Mirrors the LuxAlgo `cagr()` Pine helper applied to the strategy
 * leg: entry = (firstBarTime, initial_capital), exit = (lastBarTime,
 * initial_capital + netprofit).
*
*   daysBetween = (lastBarTime − firstBarTime) / MS_IN_ONE_DAY
*   years       = daysBetween / 365
*   CAGR%       = 100 × ((exit / entry) ^ (1 / years) − 1)
*
* The window spans the FIRST to the LAST loaded bar's open time (Pine's
* `var int firstTime = time` latched on bar 0, and `last_bar_time`). With a
* span under one day, or non-finite capital figures, the result is NaN —
* matching the Pine helper's `na` branch.
*/
const MS_IN_ONE_DAY = 24 * 60 * 60 * 1000;

function getMarketBounds(context: any): { firstTime: number; lastTime: number; lastClose: number } {
    const table = context?.table;
    const len = context?.length ?? (table?.length ?? 0);
    if (table && len > 0) {
        const firstTime = table.time ? table.time[0] : NaN;
        const lastTime = table.time ? table.time[len - 1] : NaN;
        const lastClose = table.close ? table.close[len - 1] : NaN;
        if (Number.isFinite(firstTime) && Number.isFinite(lastTime)) {
            return { firstTime, lastTime, lastClose };
        }
    }

    const candles = context?.marketData ?? context?.source;
    if (Array.isArray(candles) && candles.length > 0) {
        const first = candles[0];
        const last = candles[candles.length - 1];
        const firstTime = first.openTime ?? first.time ?? NaN;
        const lastTime = last.openTime ?? last.time ?? NaN;
        const lastClose = last.close ?? NaN;
        return { firstTime, lastTime, lastClose };
    }

    if (context?.data && len > 0) {
        try {
            const timeSeries = context.data.openTime ? Series.from(context.data.openTime) : context.data.time ? Series.from(context.data.time) : null;
            const closeSeries = context.data.close ? Series.from(context.data.close) : null;
            if (timeSeries && closeSeries) {
                const firstTime = timeSeries.get(len - 1);
                const lastTime = timeSeries.get(0);
                const lastClose = closeSeries.get(0);
                return { firstTime, lastTime, lastClose };
            }
        } catch {
            // fallback
        }
    }

    return { firstTime: NaN, lastTime: NaN, lastClose: NaN };
}

export function computeCagr(context: any): number {
    const strategy: StrategyState = context?.strategy;
    if (!strategy) return NaN;

    const { firstTime, lastTime } = getMarketBounds(context);
    if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) return NaN;

    const entryPrice = strategy.initial_capital ?? 0;
    const exitPrice = entryPrice + (strategy.netprofit ?? 0);
    const daysBetween = (lastTime - firstTime) / MS_IN_ONE_DAY;
    if (daysBetween < 1 || !Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice === 0) {
        return NaN;
    }

    const years = daysBetween / 365;
    return 100 * (Math.pow(exitPrice / entryPrice, 1 / years) - 1);
}


/**
 * Buy-and-hold benchmark statistics (TV's "Buy & Hold Return" report).
 *
 * Models a single long position bought with the ENTIRE initial capital at the
 * FIRST trade's entry price and held open through the last bar:
 *   - The anchor (price_start) is strategy._first_entry_price — the first
 *     trade's fill price, with slippage ALREADY applied by the engine. This
 *     is why the benchmark is affected by the slippage property.
 *   - The position is never sold (always open), so there is no exit leg:
 *     commissions never apply and price_end carries no slippage.
 *   - price_end is the last bar's close.
 *
 *   qty                     = initial_capital / price_start
 *   buy_and_hold_pnl        = qty × (price_end − price_start)
 *                           = initial_capital × (price_end − price_start) / price_start
 *   buy_and_hold_per_gain   = (price_end − price_start) / price_start × 100
 *   strategy_outperformance = netprofit − buy_and_hold_pnl
 *
 * Left at NaN when no trade ever opened (no entry price to anchor on) or the
 * figures are non-finite.
 */
export function computeBuyAndHold(context: any): void {
    const strategy: StrategyState = context?.strategy;
    if (!strategy) return;

    const priceStart = strategy._first_entry_price;
    const { lastClose: priceEnd } = getMarketBounds(context);
    if (!Number.isFinite(priceStart) || !Number.isFinite(priceEnd) || (priceStart as number) === 0) {
        strategy.buy_and_hold_pnl = NaN;
        strategy.buy_and_hold_per_gain = NaN;
        strategy.strategy_outperformance = NaN;
        return;
    }

    const start = priceStart as number;
    const ratio = (priceEnd - start) / start;
    strategy.buy_and_hold_per_gain = ratio * 100;
    strategy.buy_and_hold_pnl = (strategy.initial_capital ?? 0) * ratio;
    strategy.strategy_outperformance = (strategy.netprofit ?? 0) - strategy.buy_and_hold_pnl;
}


/**
 * Update strategy metrics
 */
export function updateStrategyMetrics(context: any): void {
    const strategy: StrategyState = context.strategy;

    // Net profit is already calculated when trades close.
    // Equity is updated with unrealized P&L.
    // Equity-curve peaks (max_drawdown / max_runup) and aggregate
    // win/loss stats are deferred to a later pass when those scalar
    // getters are implemented.
    void strategy;
}

export interface StrategyMetrics {
    netProfit: number;
    netProfitPercent: number;
    grossProfit: number;
    grossProfitPercent: number;
    grossLoss: number;
    grossLossPercent: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    maxRunup: number;
    maxRunupPercent: number;
    totalClosedTrades: number;
    winningTrades: number;
    losingTrades: number;
    evenTrades: number;
    percentProfitable: number;
    avgTrade: number;
    avgTradePercent: number;
    avgWinningTrade: number;
    avgWinningTradePercent: number;
    avgLosingTrade: number;
    avgLosingTradePercent: number;
    ratioAvgWinAvgLoss: number;
    largestWinningTrade: number;
    largestLosingTrade: number;
    sharpeRatio: number;
    sortinoRatio: number;
    cagr: number;
    buyAndHoldReturn: number;
    buyAndHoldReturnPercent: number;
    strategyOutperformance: number;
    maxContractsHeld: number;
}

export function computeDetailedMetrics(strategy: StrategyState): StrategyMetrics {
    const initial = strategy.initial_capital || 1;
    const totalTrades = strategy.closedtrades.length;
    const winTrades = strategy.wintrades;
    const lossTrades = strategy.losstrades;
    const evenTrades = strategy.eventrades;

    let largestWin = 0;
    let largestLoss = 0;
    let sumTradePct = 0;
    let sumWinPct = 0;
    let sumLossPct = 0;

    for (const trade of strategy.closedtrades) {
        const p = trade.profit ?? 0;
        if (p > largestWin) largestWin = p;
        if (p < largestLoss) largestLoss = p;
        const entryPrice = trade.entry_price || 1;
        const exitPrice = trade.exit_price || entryPrice;
        const dir = Math.sign(trade.size) || 1;
        const pct = ((exitPrice - entryPrice) / entryPrice) * 100 * dir;
        sumTradePct += pct;
        if (p > 0) sumWinPct += pct;
        else if (p < 0) sumLossPct += pct;
    }

    const grossP = strategy.grossprofit;
    const grossL = strategy.grossloss;
    const profitFactor = grossL > 0 ? grossP / grossL : grossP > 0 ? Infinity : 0;
    const percentProfitable = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;
    const avgTrade = totalTrades > 0 ? strategy.netprofit / totalTrades : 0;
    const avgTradePct = totalTrades > 0 ? sumTradePct / totalTrades : 0;
    const avgWin = winTrades > 0 ? strategy.wintrades_total_profit / winTrades : 0;
    const avgWinPct = winTrades > 0 ? sumWinPct / winTrades : 0;
    const avgLoss = lossTrades > 0 ? strategy.losstrades_total_loss / lossTrades : 0;
    const avgLossPct = lossTrades > 0 ? sumLossPct / lossTrades : 0;
    const winRate = totalTrades > 0 ? winTrades / totalTrades : 0;
    const lossRate = totalTrades > 0 ? lossTrades / totalTrades : 0;
    const expectancy = (winRate * avgWin) - (lossRate * avgLoss);
    const ratioWinLoss = avgLoss > 0 ? avgWin / avgLoss : 0;

    return {
        netProfit: strategy.netprofit,
        netProfitPercent: (strategy.netprofit / initial) * 100,
        grossProfit: strategy.grossprofit,
        grossProfitPercent: (strategy.grossprofit / initial) * 100,
        grossLoss: strategy.grossloss,
        grossLossPercent: (strategy.grossloss / initial) * 100,
        profitFactor,
        maxDrawdown: strategy.max_drawdown,
        maxDrawdownPercent: strategy.max_drawdown_percent_value,
        expectancy,
        maxRunup: strategy.max_runup,
        maxRunupPercent: strategy.max_runup_percent_value,
        totalClosedTrades: totalTrades,
        winningTrades: winTrades,
        losingTrades: lossTrades,
        evenTrades: evenTrades,
        percentProfitable,
        avgTrade,
        avgTradePercent: avgTradePct,
        avgWinningTrade: avgWin,
        avgWinningTradePercent: avgWinPct,
        avgLosingTrade: avgLoss,
        avgLosingTradePercent: avgLossPct,
        ratioAvgWinAvgLoss: ratioWinLoss,
        largestWinningTrade: largestWin,
        largestLosingTrade: largestLoss,
        sharpeRatio: strategy.sharpe_ratio ?? 0,
        sortinoRatio: strategy.sortino_ratio ?? 0,
        cagr: strategy.cagr ?? 0,
        buyAndHoldReturn: strategy.buy_and_hold_pnl ?? 0,
        buyAndHoldReturnPercent: strategy.buy_and_hold_per_gain ?? 0,
        strategyOutperformance: strategy.strategy_outperformance ?? 0,
        maxContractsHeld: strategy.max_contracts_held_all ?? 0,
    };
}
