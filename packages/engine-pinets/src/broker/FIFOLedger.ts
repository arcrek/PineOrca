// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { Order, StrategyState, Trade } from '../namespaces/strategy/types';
import { Series } from '../Series';



/**
 * Parse direction string/number to numeric value
 */
export function parseDirection(direction: number | string): number {
    if (typeof direction === 'number') return direction;
    if (direction === 'long') return 1;
    if (direction === 'short') return -1;
    return 0;
}


/**
 * Charge commission for one fill leg (entry OR exit) given the qty filled and
 * the price at fill. Returns the dollar amount to deduct.
 *
 * Pine commission types:
 *   - strategy.commission.percent          : commission_value % of leg notional
 *   - strategy.commission.cash_per_contract: commission_value per contract filled
 *   - strategy.commission.cash_per_order   : commission_value flat per fill leg
 */
export function computeLegCommission(context: any, strategy: StrategyState, qty: number, price: number): number {
    const type = strategy.config.commission_type ?? 'percent';
    const value = strategy.config.commission_value ?? 0;
    if (!value || value === 0) return 0;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    switch (type) {
        case 'percent':
            // Notional = qty × price × pointValue, commission is value% of it.
            return Math.abs(qty) * price * pointValue * (value / 100);
        case 'cash_per_contract':
            // value is in account currency per contract — no pointValue factor.
            return Math.abs(qty) * value;
        case 'cash_per_order':
            return value;
        default:
            return 0;
    }
}


/**
 * Update max_contracts_held_* peaks after a position-size change.
 * Called whenever position_size mutates (openTrade / closePartialPosition).
 */
export function updateMaxContractsHeld(strategy: StrategyState): void {
    const abs = Math.abs(strategy.position_size);
    if (abs > strategy.max_contracts_held_all) strategy.max_contracts_held_all = abs;
    if (strategy.position_size > strategy.max_contracts_held_long) {
        strategy.max_contracts_held_long = strategy.position_size;
    }
    if (-strategy.position_size > strategy.max_contracts_held_short) {
        strategy.max_contracts_held_short = -strategy.position_size;
    }
}


/**
 * Latches `risk_halted` when any catastrophic rule trips (max_drawdown,
 * max_intraday_loss, max_cons_loss_days). Once halted, all entries are
 * blocked for the rest of the run.
 *
 * Called after each close. The intraday rules use simple cumulative
 * approximations — true day-rollover detection would require bar timestamp
 * + timezone logic that's deferred.
 */
export function evaluateCatastrophicRiskHalt(strategy: StrategyState): void {
    if (strategy.risk_halted) return;
    const rules = strategy.risk_rules;
    if (!rules) return;

    if (rules.max_drawdown) {
        const limit =
            rules.max_drawdown.type === 'percent_of_equity' ? (rules.max_drawdown.value / 100) * strategy.equity_peak : rules.max_drawdown.value;
        if (strategy.max_drawdown >= limit) {
            strategy.risk_halted = true;
            return;
        }
    }
    if (rules.max_intraday_loss) {
        const limit =
            rules.max_intraday_loss.type === 'percent_of_equity'
                ? (rules.max_intraday_loss.value / 100) * strategy.initial_capital
                : rules.max_intraday_loss.value;
        if (strategy.grossloss >= limit) {
            strategy.risk_halted = true;
            return;
        }
    }
    if (rules.max_cons_loss_days) {
        // Group closed trades by calendar day (UTC) to evaluate consecutive loss days
        const dailyProfit = new Map<number, number>();
        for (const trade of strategy.closedtrades) {
            const dayKey = Number.isFinite(trade.exit_time) ? Math.floor((trade.exit_time as number) / 86400000) : 0;
            const current = dailyProfit.get(dayKey) ?? 0;
            dailyProfit.set(dayKey, current + (trade.profit ?? 0));
        }
        const sortedDays = Array.from(dailyProfit.keys()).sort((a, b) => b - a);
        let consecutiveDays = 0;
        for (const day of sortedDays) {
            if ((dailyProfit.get(day) ?? 0) < 0) {
                consecutiveDays++;
            } else {
                break;
            }
        }
        if (consecutiveDays >= rules.max_cons_loss_days.count) {
            strategy.risk_halted = true;
        }
    }
}


/**
 * Open a new trade.
 *
 * @param direction +1 long, -1 short
 * @param qty       unsigned contract count
 * @param price     fill price
 * @param time      fill time (ms)
 */
export function openTrade(
    context: any,
    entryId: string,
    direction: number,
    qty: number,
    price: number,
    time: number,
    entryComment?: string,
    isReversalOpen?: boolean,
): void {
    const strategy: StrategyState = context.strategy;
    const tradeNum = strategy.opentrades.length + strategy.closedtrades.length;

    // Charge entry-leg commission up front; trade.commission will be increased
    // by the exit leg when it closes (or proportional share on partial close).
    //
    // For cash_per_order on a reversal open, charge only HALF the flat fee:
    // the other half is charged to the closing leg in closePartialPosition,
    // matching TV's 50/50 split of the order's flat fee between the two legs.
    const commTypeOpen = strategy.config.commission_type ?? 'percent';
    const halveFlat = isReversalOpen && commTypeOpen === 'cash_per_order';
    const rawEntryCommission = computeLegCommission(context, strategy, qty, price);
    const entryCommission = halveFlat ? rawEntryCommission / 2 : rawEntryCommission;

    const trade: Trade = {
        id: `trade_${tradeNum}`,
        entry_id: entryId,
        // TV's strategy.closedtrades.entry_comment falls back to the entry id
        // when no explicit comment was passed to strategy.entry/order. Mirror
        // that by stamping the id as the entry comment when none is given.
        entry_comment: entryComment ?? entryId,
        entry_price: price,
        _bracket_entry: price,
        entry_bar_index: context.idx,
        entry_time: time,
        size: direction * qty, // SIGNED — matches Pine's closedtrades.size()
        commission: entryCommission,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };

    strategy.opentrades.push(trade);

    // Latch the slippage-adjusted entry price of the FIRST trade ever opened —
    // the anchor for the buy-and-hold benchmark (see finalizeStrategyRun).
    if (strategy._first_entry_price === undefined) {
        strategy._first_entry_price = price;
    }

    // FIFO ledger-entry record for TV-style exit pairing (see
    // consumeLedger / closePartialPosition): TV's xlsx pairs exit fills
    // with entry records oldest-first, splitting at record boundaries.
    ((strategy as any)._ledger_entries ??= []).push({
        entry_id: entryId,
        entry_price: price,
        entry_time: time,
        entry_bar_index: context.idx,
        entry_comment: trade.entry_comment,
        qty,
        commission: entryCommission,
    });

    // Realize the entry commission immediately as a cash outflow. TV reports
    // strategy.netprofit and strategy.grossloss net of entry commission the
    // moment the trade opens (commission is a real cost paid at fill, not
    // Entry commission hits strategy.netprofit (and grossloss as a pending
    // liability) AT FILL TIME — matches TV's `strategy.netprofit` value
    // during an open trade (verified against xlsx exports: TV's "Net profit"
    // line during an open position equals closed-trades-total minus the
    // sum of open trades' entry commissions). The exit commission is
    // realized in closePartialPosition when the trade actually closes.
    //
    // Drawdown compensation: `updateEquityPeaks` adds the open trades'
    // entry commission BACK to the drawdown formula. This mirrors TV's
    // drawdown formula which has an explicit `+ openCommission` term —
    // the result is correct for any peak timing (before vs during open
    // trade), see math in the QA-drawdown analysis notes.
    if (entryCommission > 0) {
        strategy.netprofit -= entryCommission;
        strategy.grossloss += entryCommission;
    }

    // Per-trade fill-bar excursion: capture this bar's intra-bar H/L against
    // the just-filled trade. Without this, the per-trade loop at the top of
    // processStrategyOrders misses the fill bar (it ran before this trade
    // existed in opentrades), and the bar's adverse / favorable excursion is
    // lost from trade.max_drawdown / trade.max_runup.
    //
    // Clamp at pending SL/TP trigger prices: a trade with an attached stop
    // can't actually experience price excursions past the stop — once price
    // touches the stop, the trade closes there. Without clamping, a same-bar
    // entry+SL trade records the bar's full low (a phantom excursion that
    // never happened to this trade).
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const mintick = context.pine?.syminfo?.mintick ?? 0.01;

    let worstPrice = direction === 1 ? lowPrice : highPrice;
    let bestPrice = direction === 1 ? highPrice : lowPrice;
    for (const exitOrder of strategy.pending_orders) {
        if ((exitOrder.category ?? 'entry') !== 'exit') continue;
        if (exitOrder.from_entry && exitOrder.from_entry !== entryId) continue;

        // SL trigger price (stop=absolute, loss=ticks-from-entry).
        let sl: number | undefined;
        if (exitOrder.stop !== undefined) sl = exitOrder.stop;
        else if (exitOrder.loss !== undefined) {
            sl = direction === 1 ? price - exitOrder.loss * mintick : price + exitOrder.loss * mintick;
        }
        // TP trigger price (limit=absolute, profit=ticks-from-entry).
        let tp: number | undefined;
        if (exitOrder.limit !== undefined) tp = exitOrder.limit;
        else if (exitOrder.profit !== undefined) {
            tp = direction === 1 ? price + exitOrder.profit * mintick : price - exitOrder.profit * mintick;
        }

        if (direction === 1) {
            // Long: worst is low (cap upward by sl), best is high (cap downward by tp).
            if (sl !== undefined && sl > worstPrice) worstPrice = sl;
            if (tp !== undefined && tp < bestPrice) bestPrice = tp;
        } else {
            // Short: worst is high (cap downward by sl), best is low (cap upward by tp).
            if (sl !== undefined && sl < worstPrice) worstPrice = sl;
            if (tp !== undefined && tp > bestPrice) bestPrice = tp;
        }
    }

    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    const adv = direction === 1 ? (price - worstPrice) * qty * pointValue : (worstPrice - price) * qty * pointValue;
    const fav = direction === 1 ? (bestPrice - price) * qty * pointValue : (price - bestPrice) * qty * pointValue;
    // Fold entry-leg commission into BOTH excursions: a trade is "down" by
    // the entry commission the moment it fills (so the adverse excursion
    // includes that cost), and the favorable excursion is the price gain NET
    // of that same cost (the trade has to overcome the commission first
    // before showing any runup). TV reports both metrics commission-netted.
    trade.max_drawdown = Math.max(0, adv) + entryCommission;
    trade.max_runup = Math.max(0, fav - entryCommission);

    // Update flat position scalars
    const oldSize = strategy.position_size;
    const newSize = oldSize + trade.size;

    if (oldSize === 0) {
        // Opening fresh position
        strategy.position_size = newSize;
        strategy.position_avg_price = price;
        strategy.position_entry_name = entryId;
    } else if (Math.sign(oldSize) === Math.sign(newSize)) {
        // Adding to existing same-direction position — weighted-avg the entry price
        const totalCost = Math.abs(oldSize) * strategy.position_avg_price + qty * price;
        const totalQty = Math.abs(newSize);
        strategy.position_avg_price = totalCost / totalQty;
        strategy.position_size = newSize;
    }

    updateMaxContractsHeld(strategy);
}


/**
 * Close partial or full position.
 *
 * FIFO accounting: closes oldest open trades first. Splits a trade if the
 * close qty is smaller than the trade's remaining qty.
 */
export interface CloseInfo {
    /** Which exit leg triggered ('profit'/'loss'/'trailing'), null otherwise. */
    triggerKind?: 'profit' | 'loss' | 'trailing' | null;
    /** Exit order's id, set onto the closed trade as trade.exit_id. */
    exitId?: string;
    /** Resolved exit comment (the matching comment_profit/loss/trailing). */
    exitComment?: string;
    /**
     * True when this close is part of a single REVERSAL order that will
     * also open a new trade in the opposite direction. Affects
     * `cash_per_order` commission: TV charges the flat fee ONCE per order
     * placement, attributed to the new entry — the implicit close leg of
     * the reversal does NOT incur a second flat charge. Per-leg types
     * (percent, cash_per_contract) are unaffected by this flag.
     */
    isImplicitReversal?: boolean;
}


/**
 * Consume `qty` from the strategy's FIFO ledger-entry queue (records with
 * the closing lot's entry_id), splitting records at boundaries. Returns
 * the consumed slices (entry attributes + pro-rata entry commission).
 * Falls back to the physical lot's own attributes for any quantity the
 * queue cannot supply (hand-built test states have no queue records).
 */
export function consumeLedger(
    strategy: StrategyState,
    physical: Trade,
    qty: number,
): Array<{ qty: number; entry_price: number; entry_time: number; entry_bar_index: number; entry_comment?: string; commission: number }> {
    const out: Array<{ qty: number; entry_price: number; entry_time: number; entry_bar_index: number; entry_comment?: string; commission: number }> =
        [];
    let need = qty;
    const queue: any[] = (strategy as any)._ledger_entries ?? [];
    for (const rec of queue) {
        if (need <= 1e-9) break;
        if (rec.entry_id !== physical.entry_id || rec.qty <= 1e-9) continue;
        const take = Math.min(rec.qty, need);
        const commShare = rec.qty > 0 ? rec.commission * (take / rec.qty) : 0;
        out.push({
            qty: take,
            entry_price: rec.entry_price,
            entry_time: rec.entry_time,
            entry_bar_index: rec.entry_bar_index,
            entry_comment: rec.entry_comment,
            commission: commShare,
        });
        rec.qty -= take;
        rec.commission -= commShare;
        need -= take;
    }
    (strategy as any)._ledger_entries = queue.filter((r) => r.qty > 1e-9);
    if (need > 1e-9) {
        const physQty = Math.abs(physical.size);
        out.push({
            qty: need,
            entry_price: physical.entry_price,
            entry_time: physical.entry_time,
            entry_bar_index: physical.entry_bar_index,
            entry_comment: physical.entry_comment,
            commission: physQty > 0 ? (physical.commission ?? 0) * (need / physQty) : 0,
        });
    }
    return out;
}


export function closePartialPosition(context: any, qtyToClose: number, exitPrice: number, exitTime: number, closeInfo?: CloseInfo): void {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let remainingQty = qtyToClose;

    // Close trades from oldest to newest (FIFO)
    const tradesToClose = [...strategy.opentrades];
    strategy.opentrades = [];

    for (const trade of tradesToClose) {
        if (remainingQty <= 0) {
            // Keep this trade open
            strategy.opentrades.push(trade);
            continue;
        }

        const tradeQty = Math.abs(trade.size);
        const qtyClosing = Math.min(tradeQty, remainingQty);
        const tradeDirection = Math.sign(trade.size);

        // TV LEDGER PAIRING: exit fills pair against a FIFO queue of ENTRY
        // RECORDS (per entry_id), SPLITTING at record boundaries — a fill
        // of 5 contracts can consume 4.74018 of the oldest unpaired entry
        // plus 0.25982 of the next, producing TWO ledger rows (TV xlsx
        // 2021-11-16). Physical lots (this loop) only drive position,
        // margin and bracket levels; the closed-trade ROWS and the
        // financial aggregates follow the ledger slices. `consumeLedger`
        // falls back to the physical lot's own attributes when no queue
        // records exist (hand-built tests).
        //
        // Per-row semantics preserved from the previous implementation:
        //   - netprofit increment = gross − exit-commission share (the
        //     entry leg was realized at fill), per the TV convention
        //     verified in the drawdown/margin QA sessions;
        //   - grossloss rollback of the entry-commission share;
        //   - SL/TP per-trade peak overrides (loss → max_runup = 0,
        //     profit → max_drawdown = entry commission share);
        //   - cash_per_order half-fee on implicit-reversal closes.
        const emitClosedRows = (qtyClosed: number) => {
            const commType = strategy.config.commission_type ?? 'percent';
            const halveFlat = closeInfo?.isImplicitReversal && commType === 'cash_per_order';
            const rawExitCommission = computeLegCommission(context, strategy, qtyClosed, exitPrice);
            const exitCommTotal = halveFlat ? rawExitCommission / 2 : rawExitCommission;

            const slices = consumeLedger(strategy, trade, qtyClosed);
            for (const s of slices) {
                const exitCommShare = exitCommTotal * (s.qty / qtyClosed);
                const priceChange = tradeDirection === 1 ? exitPrice - s.entry_price : s.entry_price - exitPrice;
                const gross = priceChange * s.qty * pointValue;

                const row: Trade = {
                    id: `trade_${strategy.opentrades.length + strategy.closedtrades.length + tradesToClose.length}`,
                    entry_id: trade.entry_id,
                    entry_comment: s.entry_comment,
                    entry_price: s.entry_price,
                    _bracket_entry: trade._bracket_entry,
                    entry_bar_index: s.entry_bar_index,
                    entry_time: s.entry_time,
                    size: tradeDirection * s.qty,
                    commission: s.commission + exitCommShare,
                    max_drawdown: trade.max_drawdown,
                    max_runup: trade.max_runup,
                    status: 'closed',
                    exit_price: exitPrice,
                    exit_bar_index: context.idx,
                    exit_time: exitTime,
                    exit_id: closeInfo?.exitId ?? trade.exit_id,
                    exit_comment: closeInfo?.exitComment ?? trade.exit_comment,
                    profit: gross - s.commission - exitCommShare,
                };
                if (closeInfo?.triggerKind === 'loss') row.max_runup = 0;
                if (closeInfo?.triggerKind === 'profit') row.max_drawdown = s.commission;

                strategy.netprofit += gross - exitCommShare;
                strategy.grossloss -= s.commission;
                if (row.profit! > 0) {
                    strategy.grossprofit += row.profit!;
                    strategy.wintrades++;
                    strategy.wintrades_total_profit += row.profit!;
                } else if (row.profit! < 0) {
                    strategy.grossloss += Math.abs(row.profit!);
                    strategy.losstrades++;
                    strategy.losstrades_total_loss += Math.abs(row.profit!);
                } else {
                    strategy.eventrades++;
                }
                strategy.closedtrades.push(row);
            }
        };

        // Epsilon on the full-close decision: when the requested qty is a
        // float hair short of the trade's size (fractional margin-call
        // remainders), treat it as a full close instead of leaving a
        // ~1e-15 ghost portion open.
        if (qtyClosing >= tradeQty - 1e-9) {
            // Fully close this physical lot.
            trade.status = 'closed';
            trade.exit_price = exitPrice;
            trade.exit_bar_index = context.idx;
            trade.exit_time = exitTime;
            emitClosedRows(tradeQty);
            remainingQty -= qtyClosing;
        } else {
            // Partially close this physical lot — emit ledger rows for the
            // closed quantity, keep the remainder open with its residual
            // PHYSICAL entry-commission share (used by the equity-peak
            // basis and margin checks).
            emitClosedRows(qtyClosing);
            const entryCommissionShare = (trade.commission ?? 0) * (qtyClosing / tradeQty);

            // The remaining open portion keeps the residual entry commission share.
            trade.size = tradeDirection * (tradeQty - qtyClosing);
            trade.commission = (trade.commission ?? 0) - entryCommissionShare;
            strategy.opentrades.push(trade);
            remainingQty = 0;
        }
    }

    // Catastrophic risk-rule halt check after this close.
    evaluateCatastrophicRiskHalt(strategy);

    // Update flat position scalars from the (possibly shrunken) open-trade book
    const currentSize = strategy.position_size;
    const sizeReduction = Math.sign(currentSize) * qtyToClose; // Reduce magnitude
    let newSize = currentSize - sizeReduction;

    // Epsilon-snap to flat: fractional quantities (margin-call partial
    // liquidations) leave float residuals (~1e-15) when the position fully
    // unwinds. An exact `=== 0` check then misses the flatten, leaving
    // position_avg_price alive on a ghost position — the script captures
    // stale TP/SL prices from it and the next entry gets phantom-exited at
    // its own entry price (QA pyramiding xlsx, 2021-11-09 BTCUSDC).
    if (Math.abs(newSize) < 1e-9) newSize = 0;

    strategy.position_size = newSize;
    updateMaxContractsHeld(strategy);

    if (newSize === 0) {
        strategy.position_avg_price = NaN;
        strategy.position_entry_name = '';
    } else if (strategy.opentrades.length > 0) {
        // Recompute average entry price from the remaining open book
        // (LEDGER view — see ledgerOpenLots). Crucial because closing
        // older entries (FIFO pairing) changes the weighted average if
        // the position was built from multiple entries at different
        // prices.
        let totalCost = 0;
        let totalQty = 0;
        for (const t of ledgerOpenLots(strategy)) {
            totalCost += t.qty * t.entry_price;
            totalQty += t.qty;
        }
        strategy.position_avg_price = totalCost / totalQty;
        // position_entry_name keeps pointing at whichever entry opened the
        // first still-open trade
        strategy.position_entry_name = strategy.opentrades[0].entry_id;
    }
}


/**
 * The open book in LEDGER view: the FIFO entry records not yet paired
 * with exit fills. ALL equity-side computations (unrealized PnL, average
 * entry, open entry commissions) must use this view so they stay
 * consistent with `netprofit`, whose increments follow the ledger slices
 * — TV's equity is fully ledger-based, and mixing ledger-realized with
 * physical-unrealized breaks total-equity invariance whenever exit
 * pairing crosses lot boundaries. Falls back to the physical lots when
 * no records exist (hand-built test states).
 */
export function ledgerOpenLots(strategy: StrategyState): Array<{ qty: number; entry_price: number; commission: number; dir: number }> {
    const records: any[] = (strategy as any)._ledger_entries ?? [];
    const dir = Math.sign(strategy.position_size) || 1;
    if (records.length > 0) {
        return records.map((r) => ({ qty: r.qty, entry_price: r.entry_price, commission: r.commission, dir }));
    }
    return strategy.opentrades.map((t) => ({
        qty: Math.abs(t.size),
        entry_price: t.entry_price,
        commission: t.commission ?? 0,
        dir: Math.sign(t.size),
    }));
}


/**
 * FIFO close of `qtyToClose` contracts from open trades, optionally filtered
 * by `fromEntry` — when set, only trades whose `entry_id === fromEntry` are
 * eligible. Falls back to closing across all open trades when empty/undefined.
 *
 * Wraps `closePartialPosition` by temporarily reorganizing `opentrades` so
 * the matching trades sit at the head of the FIFO queue.
 */
export function closeMatching(
    context: any,
    fromEntry: string | undefined,
    qtyToClose: number,
    exitPrice: number,
    exitTime: number,
    closeInfo?: CloseInfo,
    specificTradeId?: string,
): void {
    const strategy: StrategyState = context.strategy;

    // Per-LOT close (exit brackets): TV binds each bracket to the physical
    // entry lot whose entry price computed its level — the fill closes
    // THAT lot, not the oldest. FIFO entry/exit pairing for the ledger is
    // handled inside closePartialPosition (see the ledger-swap there).
    if (specificTradeId !== undefined) {
        const target: Trade[] = [];
        const others: Trade[] = [];
        for (const t of strategy.opentrades) {
            if (t.id === specificTradeId) target.push(t);
            else others.push(t);
        }
        if (target.length === 0) return;
        const targetQty = Math.abs(target[0].size);
        strategy.opentrades = [...target, ...others];
        closePartialPosition(context, Math.min(qtyToClose, targetQty), exitPrice, exitTime, closeInfo);
        return;
    }

    if (!fromEntry || fromEntry === '' || (strategy.config.close_entries_rule === 'FIFO' && specificTradeId === undefined)) {
        // No filter or strict FIFO rule — close FIFO across all open trades.
        closePartialPosition(context, qtyToClose, exitPrice, exitTime, closeInfo);
        return;
    }

    // Reorder: matching trades first (preserving their relative order),
    // non-matching second. closePartialPosition closes FIFO from the front
    // so this gives us a filtered FIFO.
    const matching: Trade[] = [];
    const others: Trade[] = [];
    for (const t of strategy.opentrades) {
        if (t.entry_id === fromEntry) matching.push(t);
        else others.push(t);
    }
    const matchingQty = matching.reduce((sum, t) => sum + Math.abs(t.size), 0);
    if (matchingQty === 0) return;
    const effectiveClose = Math.min(qtyToClose, matchingQty);

    strategy.opentrades = [...matching, ...others];
    closePartialPosition(context, effectiveClose, exitPrice, exitTime, closeInfo);
}
