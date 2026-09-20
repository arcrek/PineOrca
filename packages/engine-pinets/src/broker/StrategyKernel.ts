// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { StrategyConfig, StrategyState, Order, Trade } from '../namespaces/strategy/types';
import { Series } from '../Series';
import { processStrategyOrders } from './OrderMatcher';
import { processExitOrders, isAdverseFirstBar } from './IntrabarSimulator';
import { processMarginCall, applyPendingCloseMarginCall } from './MarginCallEngine';
import { finalizeStrategyBar, finalizeStrategyRun } from './MetricsCalculator';


/**
 * Parse strategy() function arguments
 */
export function parseStrategyOptions(args: any[]): any {
    // Pine v5/v6 strategy() signature:
    //   strategy(title, shorttitle, overlay, format, precision, scale,
    //            pyramiding, calc_on_order_fills, ...)
    // The transpiler emits leading POSITIONAL strings (title, optionally
    // shorttitle) followed by a trailing object with all named args.
    // Three input shapes show up in practice:
    //   1. strategy("title")                       — title only
    //   2. strategy("title", { opts })             — title + named args
    //   3. strategy("title", "shorttitle", {opts}) — Pine v6 with shorttitle
    // The original implementation handled #1 and #2 but DROPPED the
    // trailing options object in #3 (returning only { title }), which
    // silently lost commission_type, commission_value, overlay, and every
    // other named arg.
    if (args.length === 0) return {};

    // If first arg is itself an object, treat it as the whole options bag.
    if (typeof args[0] === 'object' && args[0] !== null) {
        return args[0];
    }

    const options: any = {};
    if (typeof args[0] === 'string') options.title = args[0];

    // Walk remaining args. Strings are positional (so far only shorttitle
    // is observed in this position). The LAST object encountered is the
    // named-args bundle — its keys win over positional fields if there's
    // overlap (matching Pine's behavior of named args overriding positional).
    let trailingOptions: any = null;
    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (typeof a === 'string') {
            // Currently only shorttitle slots in as a positional string.
            // If future Pine versions add more positional strings, extend
            // here.
            if (options.shorttitle === undefined) options.shorttitle = a;
        } else if (typeof a === 'object' && a !== null) {
            trailingOptions = a;
        }
    }
    if (trailingOptions) Object.assign(options, trailingOptions);
    return options;
}


/**
 * Initialize strategy state
 */
export function initializeStrategy(context: any, config: any): void {
    const defaults = {
        title: '',
        shorttitle: '',
        overlay: false,
        format: 'inherit',
        precision: 10,
        scale: 'right',
        pyramiding: 1,
        calc_on_order_fills: false,
        calc_on_every_tick: false,
        max_bars_back: 0,
        backtest_fill_limits_assumption: 0,
        default_qty_type: 'fixed',
        default_qty_value: 1,
        initial_capital: 1000000,
        currency: 'USD',
        slippage: 0,
        commission_type: 'percent',
        commission_value: 0,
        margin_long: 100,
        margin_short: 100,
        explicit_plot_zorder: false,
        max_lines_count: 50,
        max_labels_count: 50,
        max_boxes_count: 50,
        max_polylines_count: 50,
        risk_free_rate: 2,
        use_bar_magnifier: false,
        fill_orders_on_standard_ohlc: false,
    };

    // Layer order: spec defaults ← source call args ← user .prop overrides (latest wins).
    const finalConfig = { ...defaults, ...config, ...(context._propOverrides ?? {}) };
    const initialCapital = finalConfig.initial_capital;

    context.strategy = {
        config: finalConfig,

        // Trade collections
        opentrades: [],
        closedtrades: [],
        pending_orders: [],

        // Flat position scalars
        position_size: 0,
        position_avg_price: NaN, // Pine returns NaN when flat
        position_entry_name: '',

        // Account info
        initial_capital: initialCapital,
        account_currency: finalConfig.currency || 'USD',
        equity: initialCapital,
        netprofit: 0,
        grossprofit: 0,
        grossloss: 0,
        openprofit: 0,

        // Peaks
        max_drawdown: 0,
        max_runup: 0,
        equity_peak: initialCapital,
        equity_trough: initialCapital,
        equity_at_runup_peak: initialCapital,
        equity_at_drawdown_peak: initialCapital,
        max_drawdown_percent_value: 0,
        max_runup_percent_value: 0,

        // Risk-adjusted ratios (computed at end-of-run) + their internal
        // monthly-equity accumulator.
        sharpe_ratio: 0,
        sortino_ratio: 0,
        cagr: NaN,

        // Buy-and-hold benchmark (computed at end-of-run; NaN until then).
        buy_and_hold_pnl: NaN,
        buy_and_hold_per_gain: NaN,
        strategy_outperformance: NaN,
        _first_entry_price: undefined,

        _monthly_equity: [],
        _last_month_key: -1,

        // Trade-stat counters
        wintrades: 0,
        losstrades: 0,
        eventrades: 0,
        wintrades_total_profit: 0,
        losstrades_total_loss: 0,

        // Position-size peaks
        max_contracts_held_all: 0,
        max_contracts_held_long: 0,
        max_contracts_held_short: 0,

        // Risk-management rules (configured via strategy.risk.*)
        risk_rules: {},
        risk_halted: false,

        // Cadence tracking for strategy.exit (see types.ts).
        _exit_call_history: new Map<string, number>(),
        _exit_fallback_counter: 0,
        _exit_fallback_last_bar: -1,
    };
}

export {
    clonePlainValue,
    snapshotStrategyState,
    restoreStrategyState,
} from '../streaming/StateSnapshot';

/**
 * Unified bar execution loop driving order fills, script ticks, and equity latching.
 * Executes all broker emulator checkpoints for the current bar in canonical TradingView sequence.
 */
export function stepBar(context: any): void {
    if (!context.strategy) return;
    applyPendingCloseMarginCall(context);
    processStrategyOrders(context);
    processMarginCall(context, 'open');
    const adverseFirst = isAdverseFirstBar(context);
    if (adverseFirst) processMarginCall(context, 'extreme');
    processExitOrders(context, 'intrabar');
    if (!adverseFirst) processMarginCall(context, 'extreme');
    finalizeStrategyBar(context);
}

/**
 * Finalize strategy metrics and risk ratios at the end of the backtest run.
 */
export function finalizeRun(context: any): void {
    if (context.strategy) {
        finalizeStrategyRun(context);
    }
}

