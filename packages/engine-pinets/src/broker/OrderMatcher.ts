// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { Order, StrategyState, Trade } from '../namespaces/strategy/types';
import { Series } from '../Series';
import {
  parseDirection,
  openTrade,
  closePartialPosition,
  updateMaxContractsHeld,
  evaluateCatastrophicRiskHalt,
} from './FIFOLedger';
import { computeRequiredMargin, computeHeldMargin } from './MarginCallEngine';
import { markToMarket, updateStrategyMetrics } from './MetricsCalculator';



/**
 * Round a stop/limit price to the symbol's mintick grid, AWAY from the
 * reference price (typically the current bar's close at order placement).
 *
 * Pine's broker emulator places stop/limit orders on the mintick grid
 * conservatively — a buy stop at 4188.4541 above current 4184 becomes
 * 4188.46 (ceiling), not 4188.45. This makes the order trigger LATER
 * (requires more price movement), mirroring real-broker order placement.
 *
 * The rule:
 *   price > referencePrice → ceil to mintick (push price UP)
 *   price < referencePrice → floor to mintick (push price DOWN)
 *   price === referencePrice → return as-is
 *
 * Covers all four cases naturally:
 *   - Buy stop above current  → ceil
 *   - Sell stop below current → floor
 *   - Buy limit below current → floor
 *   - Sell limit above current → ceil
 *   - Long TP above entry / SL below entry → ceil / floor
 *   - Short TP below entry / SL above entry → floor / ceil
 *
 * For mintick === 0 or undefined (defensive), returns the price unchanged.
 */
export function roundToMintick(price: number, referencePrice: number, mintick: number): number {
    if (!mintick || mintick <= 0 || !Number.isFinite(price)) return price;
    if (price === referencePrice) return price;
    const ticks = price / mintick;
    // Small epsilon guards against float-imprecision flipping an
    // already-on-grid value to the next tick.
    const EPS = 1e-9;
    return price > referencePrice ? Math.ceil(ticks - EPS) * mintick : Math.floor(ticks + EPS) * mintick;
}


/**
 * Calculate order quantity based on strategy configuration
 */
export function calculateOrderQty(context: any, specifiedQty: number | undefined, direction: number, fillPrice: number): number {
    const strategy: StrategyState = context.strategy;

    // Get qty type and value, calling functions if needed
    let qtyType = strategy.config.default_qty_type || 'fixed';
    let qtyValue = strategy.config.default_qty_value || 1;

    // If qtyType is a function, call it to get the actual string value
    if (typeof qtyType === 'function') {
        qtyType = (qtyType as Function)();
    }

    // If qtyValue is a function, call it to get the actual numeric value
    if (typeof qtyValue === 'function') {
        qtyValue = (qtyValue as Function)();
    }

    // Pine's broker emulator truncates the computed qty to 6 decimal
    // places. The precision is hardcoded — independent of the symbol's
    // mincontract or pricescale. Truncation applies to every code path
    // (specifiedQty, fixed, cash, percent_of_equity) so a downstream
    // mark-to-market loop doesn't accumulate the sub-microscopic delta
    // between the raw float and TV's reported size over many bars.
    const QTY_PRECISION = 1e6;
    const truncateQty = (q: number) => Math.floor(q * QTY_PRECISION) / QTY_PRECISION;

    if (specifiedQty !== undefined && specifiedQty !== null) {
        return truncateQty(Math.abs(specifiedQty));
    }

    let rawQty: number;
    switch (qtyType) {
        case 'fixed':
            rawQty = qtyValue;
            break;

        case 'cash': {
            // Calculate how many units we can buy with the cash amount, factoring in pointValue
            const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
            rawQty = qtyValue / (fillPrice * pointValue);
            break;
        }

        case 'percent_of_equity': {
            // Calculate quantity based on percentage of equity, factoring in pointValue
            // qty_value=10 means 10% of equity
            const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
            const positionValue = (strategy.equity * qtyValue) / 100;
            rawQty = positionValue / (fillPrice * pointValue);
            break;
        }
        default:
            rawQty = qtyValue;
    }
    return truncateQty(rawQty);
}


/**
 * Process pending orders and execute them
 */
export function processStrategyOrders(context: any): void {
    if (!context.strategy) return;

    const strategy: StrategyState = context.strategy;
    if (!strategy.pending_orders) strategy.pending_orders = [];
    if (!strategy.opentrades) strategy.opentrades = [];
    if (!strategy.closedtrades) strategy.closedtrades = [];
    const { pending_orders } = strategy;

    // Get current bar's OHLC data
    const openPrice = Series.from(context.data.open).get(0);
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const closePrice = Series.from(context.data.close).get(0);
    const currentTime = Series.from(context.data.openTime).get(0);

    // Per-trade peak adverse / favorable excursion (max-drawdown / max-runup
    // on each open trade) using INTRA-BAR high/low rather than close-only.
    // Both excursions are commission-netted (entry leg charged on fill):
    //   - max_drawdown includes the entry commission as a baseline cost.
    //   - max_runup is the favorable price gain net of that same cost.
    // This matches TV's per-trade reporting.
    //
    // pointValue converts a one-unit price move into account-currency dollars.
    // For BTC and most crypto/forex it's 1; for futures it can be e.g. $50
    // per point on the ES E-mini. Multiplied into every priceChange × qty
    // computation throughout this file so excursions and P&L are in $.
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    for (const trade of strategy.opentrades) {
        const tradeQty = Math.abs(trade.size);
        const isLongTrade = trade.size > 0;
        const entryComm = trade.commission ?? 0;
        const advPrice = isLongTrade
            ? (trade.entry_price - lowPrice) * tradeQty * pointValue
            : (highPrice - trade.entry_price) * tradeQty * pointValue;
        const favPrice = isLongTrade
            ? (highPrice - trade.entry_price) * tradeQty * pointValue
            : (trade.entry_price - lowPrice) * tradeQty * pointValue;
        const advNet = Math.max(0, advPrice) + entryComm;
        const favNet = Math.max(0, favPrice - entryComm);
        if (advNet > (trade.max_drawdown ?? 0)) trade.max_drawdown = advNet;
        if (favNet > (trade.max_runup ?? 0)) trade.max_runup = favNet;
    }

    // Mark-to-market at OPEN price so fill logic / risk checks see accurate equity.
    // Peaks are NOT latched here; updateEquityPeaks runs once at the bar's end.
    markToMarket(context, openPrice);

    // Process each pending order that was placed on a previous bar
    for (const order of pending_orders) {
        if (order.status !== 'pending') continue;

        // Skip exit-category orders — processExitOrders handles them.
        if ((order.category ?? 'entry') === 'exit') continue;

        // Orders placed on bar N can only fill on bar N+1 or later
        // Skip if this order was placed on the current bar (context.idx)
        if (order.bar >= context.idx) {
            continue;
        }

        let shouldFill = false;
        let fillPrice = openPrice;

        // Determine if order should be filled based on type
        switch (order.type) {
            case 'market':
                // Market orders fill at current bar's open (which is "next bar's open" from order placement)
                shouldFill = true;
                fillPrice = openPrice;
                break;

            case 'limit':
                // Limit orders fill when price reaches the limit level
                if (order.limit !== undefined) {
                    const direction = parseDirection(order.direction);
                    if (direction === 1 && lowPrice <= order.limit) {
                        // Long limit order - buy when price drops to limit
                        shouldFill = true;
                        fillPrice = order.limit;
                    } else if (direction === -1 && highPrice >= order.limit) {
                        // Short limit order - sell when price rises to limit
                        shouldFill = true;
                        fillPrice = order.limit;
                    }
                }
                break;

            case 'stop':
                // Stop orders fill when price crosses the stop level
                if (order.stop !== undefined) {
                    const direction = parseDirection(order.direction);
                    if (direction === 1 && highPrice >= order.stop) {
                        // Long stop order - buy when price rises to stop.
                        // If the bar opened above stop, fill at openPrice (gap fill).
                        shouldFill = true;
                        fillPrice = openPrice > order.stop ? openPrice : order.stop;
                    } else if (direction === -1 && lowPrice <= order.stop) {
                        // Short stop order - sell when price falls to stop.
                        // If the bar opened below stop, fill at openPrice (gap fill).
                        shouldFill = true;
                        fillPrice = openPrice < order.stop ? openPrice : order.stop;
                    }
                }
                break;
        }

        if (shouldFill) {
            // Pre-fill risk check: block if any active risk rule violates.
            if (isOrderBlockedByRisk(strategy, order)) {
                order.status = 'cancelled';
                continue;
            }

            // Apply slippage against the trade direction (longs fill higher,
            // shorts fill lower). slippage is in ticks of syminfo.mintick.
            const direction = parseDirection(order.direction);
            fillPrice = applySlippage(context, direction, fillPrice);

            // Pre-trade margin check (Pine broker emulator). When the
            // required margin for the new position would exceed available
            // equity at fill time, the order is silently dropped — no
            // trade record, no log. For reversals the close leg always
            // succeeds (frees its prior margin) and only the new open leg
            // is checked. For pyramiding (same-direction adds), held
            // margin from existing positions stays locked.
            //
            // Runs for ALL margin percentages. At 100% margin the required
            // margin equals the full notional (qty * price * pointValue * 1),
            // matching TV's broker-emulator behavior of rejecting entries
            // whose notional exceeds available equity even with no leverage.
            const marginPct = direction === 1 ? (strategy.config.margin_long ?? 100) : (strategy.config.margin_short ?? 100);
            {
                const oldSize = strategy.position_size;
                const oldSign = Math.sign(oldSize);
                const isReversal = oldSign !== 0 && oldSign !== direction;
                const newOpenQty = isReversal ? Math.max(0, order.qty - Math.abs(oldSize)) : order.qty;

                if (newOpenQty > 0) {
                    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
                    // Equity is already MtM'd at OPEN by markToMarket() at the
                    // top of processStrategyOrders, so strategy.equity is the
                    // current account value. Subtract margin held by positions
                    // that will REMAIN after this order:
                    //   - reversal: nothing remains from old position.
                    //   - pyramiding (same dir): existing held margin stays.
                    //   - fresh entry: nothing held to begin with.
                    let heldMarginRemaining = 0;
                    if (oldSign === direction) {
                        heldMarginRemaining = computeHeldMargin(context, openPrice);
                    }
                    const availableEquity = strategy.equity - heldMarginRemaining;
                    const requiredMargin = computeRequiredMargin(newOpenQty, fillPrice, marginPct, pointValue);

                    if (requiredMargin > availableEquity) {
                        // TV broker emulator: the margin check only guards the
                        // OPEN leg. On a reversal, the close leg always
                        // executes (it frees margin / realizes the position) —
                        // TV's exit shows the reversal order's id as exit id
                        // while no opposite position appears. Verified against
                        // QA margin_calls xlsx: after a partial margin-call
                        // liquidation, the remainder was closed by the next
                        // reversal order whose open leg was margin-rejected.
                        const qtyToClose = Math.min(Math.abs(oldSize), order.qty);
                        if (isReversal && qtyToClose > 0) {
                            closePartialPosition(context, qtyToClose, fillPrice, currentTime, {
                                exitId: order.id,
                                exitComment: order.comment,
                            });
                            order.status = 'filled';
                            order.fill_price = fillPrice;
                            order.fill_bar = context.idx;
                            order.fill_time = currentTime;
                        } else {
                            order.status = 'cancelled';
                        }
                        continue;
                    }
                }
            }

            // Execute the order using the pre-calculated qty
            executeOrder(context, order, fillPrice, currentTime);
            order.status = 'filled';
            order.fill_price = fillPrice;
            order.fill_bar = context.idx;
            order.fill_time = currentTime;
        }
    }

    // Remove filled and cancelled orders
    strategy.pending_orders = pending_orders.filter((o) => o.status === 'pending');

    // Refresh equity at CLOSE for processExitOrders' opening read.
    // Peaks are latched at the bar's end inside processExitOrders.
    markToMarket(context, closePrice);
    updateStrategyMetrics(context);
}


/**
 * Apply slippage to a nominal fill price, shifting against the trade's
 * direction (longs fill higher, shorts fill lower). slippage is expressed in
 * ticks of `syminfo.mintick`. Returns the adjusted fill price.
 */
export function applySlippage(context: any, direction: number, nominalPrice: number): number {
    const strategy: StrategyState = context.strategy;
    const slippage = strategy.config.slippage ?? 0;
    if (!slippage || slippage === 0) return nominalPrice;
    const mintick = context.pine?.syminfo?.mintick ?? 0.01;
    const slippageAmount = slippage * mintick;
    return direction === 1 ? nominalPrice + slippageAmount : nominalPrice - slippageAmount;
}


/**
 * Returns true if adding a same-direction entry would exceed the strategy's
 * pyramiding cap. Counts existing open trades in the requested direction.
 *
 * `strategy.entry()` (when implemented) consults this; `strategy.order()` does
 * NOT — Pine treats strategy.order as a low-level primitive that ignores the
 * pyramiding limit.
 */
export function wouldExceedPyramiding(strategy: StrategyState, direction: number): boolean {
    const cap = strategy.config.pyramiding ?? 1;
    let openSameSide = 0;
    for (const t of strategy.opentrades) {
        if (Math.sign(t.size) === direction) openSameSide++;
    }
    return openSameSide >= cap;
}


/**
 * Pre-fill risk-rule check. Returns true if the order should be BLOCKED.
 *
 * Consulted rules (independent; first violation wins):
 *   - risk_halted (latched by any catastrophic rule)
 *   - allow_entry_in: 'long' blocks short orders; 'short' blocks long
 *   - max_position_size: post-fill |position_size| would exceed N
 */
export function isOrderBlockedByRisk(strategy: StrategyState, order: Order): boolean {
    if (strategy.risk_halted) return true;
    const rules = strategy.risk_rules;
    if (!rules) return false;
    const orderDir = order.direction;

    if (rules.allow_entry_in) {
        if (rules.allow_entry_in === 'long' && orderDir === -1) return true;
        if (rules.allow_entry_in === 'short' && orderDir === 1) return true;
    }
    if (rules.max_position_size !== undefined) {
        const postSize = strategy.position_size + orderDir * order.qty;
        if (Math.abs(postSize) > rules.max_position_size) return true;
    }
    return false;
}


/**
 * Execute an order
 * strategy.order() modifies the net position directly
 */
export function executeOrder(context: any, order: Order, fillPrice: number, fillTime: number): void {
    const strategy: StrategyState = context.strategy;
    const direction = parseDirection(order.direction);
    const oldPosition = strategy.position_size;
    const oldSign = Math.sign(oldPosition);

    // Check if we are reducing/reversing the position
    // (Long position and selling, or Short position and buying)
    const isReducing = (oldSign === 1 && direction === -1) || (oldSign === -1 && direction === 1);

    if (isReducing) {
        // We are reducing or reversing
        // First, use the order to close existing trades. For a reversal,
        // the reversing order's id/comment become the EXIT id/comment of
        // the prior trade — that's TV behavior.
        const qtyToClose = Math.min(Math.abs(oldPosition), order.qty);
        const remainingQty = order.qty - qtyToClose;
        // True reversal: the SAME order both flattens the prior position
        // AND opens a new one in the opposite direction. For cash_per_order
        // commission, TV charges the order's flat fee ONCE total — split
        // 50/50 between the closing leg and the opening leg (so the closing
        // trade gets +value/2 and the new trade also gets +value/2 on its
        // entry). Marking the close with isImplicitReversal triggers that
        // half-charge in closePartialPosition; the new openTrade is told
        // separately to apply the same half-charge.
        const isReversal = remainingQty > 0;
        closePartialPosition(context, qtyToClose, fillPrice, fillTime, {
            exitId: order.id,
            exitComment: order.comment,
            isImplicitReversal: isReversal,
        });

        // If there is remaining quantity (reversal), open a new trade.
        // When the close leg consumed LESS than the order anticipated at
        // queue time (a deferred close-margin-call shrank the position
        // between queue and fill), the remaining qty exceeds the ordered
        // base size. TV books the intended base size and the overshoot as
        // TWO separate lots (each with its own exit bracket and ledger
        // row — xlsx 2021-10-02: longs 5 + 0.263108 at the same fill).
        if (remainingQty > 0) {
            const baseQty = (order as any)._base_qty;
            if (baseQty !== undefined && remainingQty > baseQty + 1e-9) {
                openTrade(context, order.id, direction, baseQty, fillPrice, fillTime, order.comment, /* isReversalOpen */ true);
                openTrade(context, order.id, direction, remainingQty - baseQty, fillPrice, fillTime, order.comment, /* isReversalOpen */ true);
            } else {
                openTrade(context, order.id, direction, remainingQty, fillPrice, fillTime, order.comment, /* isReversalOpen */ true);
            }
        }
    } else {
        // We are increasing position or opening fresh
        openTrade(context, order.id, direction, order.qty, fillPrice, fillTime, order.comment);
    }
}

export { parseDirection, updateMaxContractsHeld, evaluateCatastrophicRiskHalt };
