// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { Order, StrategyState, Trade } from '../namespaces/strategy/types';
import { Series } from '../Series';
import { closeMatching } from './FIFOLedger';
import { applySlippage } from './OrderMatcher';
import { markToMarket } from './MetricsCalculator';



/**
 * Process exit-category orders each bar (after entry-order fills, before the
 * user script runs). Handles:
 *   - Market exits from strategy.close() / strategy.close_all() (fill at
 *     current bar's open if placed previously).
 *   - Conditional exits from strategy.exit() — TP / SL / trailing-stop
 *     triggers evaluated against current bar's high/low. Trailing-stop
 *     peak (trade.trail_peak) is updated each bar even when not triggered.
 */
export function processExitOrders(context: any, phase: 'open' | 'intrabar' = 'intrabar'): void {
    if (!context.strategy) return;
    const strategy: StrategyState = context.strategy;
    if (strategy.pending_orders.length === 0) return;

    const openPrice = Series.from(context.data.open).get(0);
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const closePrice = Series.from(context.data.close).get(0);
    const currentTime = Series.from(context.data.openTime).get(0);
    const mintick = context.pine?.syminfo?.mintick ?? 0.01;

    // Two-phase evaluation (TV broker-emulator order precedence at the
    // bar's open):
    //   phase 'open'     — runs BEFORE entry fills. Only conditional-exit
    //                      GAP-FILLS execute (the bar opened already past a
    //                      bracket's trigger → fill at the open). Brackets
    //                      consumed here never extend to entries filling at
    //                      the same open.
    //   phase 'intrabar' — runs AFTER entry fills. Everything else:
    //                      market closes, intra-bar crossings, trail, and
    //                      gap-fills for trades that ATTACHED at this bar's
    //                      open (an exit order waiting on a not-yet-filled
    //                      entry brackets it at fill time — if the open is
    //                      already past the trigger it exits immediately).
    //
    // QA evidence (pyramiding avg_price xlsx, BTCUSDC 1D): a stop
    // gap-firing at the open closes ONLY the prior stack — the pyramid
    // entry filling at that same open survives (2024-03-21); while an exit
    // order surviving to intra-bar crossing closes same-bar entries too
    // (2020-12-17), and a waiting order attaches to a reversal entry and
    // gap-exits it at its own fill price (2021-09-08).
    for (const order of strategy.pending_orders) {
        if (order.status !== 'pending') continue;
        if ((order.category ?? 'entry') !== 'exit') continue;

        // Gather matching open trades (from_entry filter; '' = all).
        // For market closes from strategy.close_all() / strategy.close(id),
        // additionally restrict to the trade IDs captured at QUEUE time —
        // these orders are bound to the position state at call time, not
        // fill time. If a reversal entry implicitly closed the snapshotted
        // trades before this order fires, the order has no target and gets
        // cancelled, mirroring TV's behavior of treating
        // strategy.close_all() as a no-op when its intended position is
        // already gone.
        let matching = strategy.opentrades.filter((t) => !order.from_entry || t.entry_id === order.from_entry);
        if (order._intended_trade_ids) {
            const snapshot = new Set(order._intended_trade_ids);
            matching = matching.filter((t) => snapshot.has(t.id));
        }
        if (matching.length === 0) {
            // Nothing to exit. In the pre-entry phase the order may be
            // WAITING on an entry that fills at this bar's open (TV: exit
            // orders placed before their entry wait for it) — leave it
            // pending. After entries have filled (intrabar phase), an
            // exit with no matching trades is dead — clear it.
            if (phase === 'intrabar') order.status = 'cancelled';
            continue;
        }

        const matchingQty = matching.reduce((sum, t) => sum + Math.abs(t.size), 0);
        const matchingDir = Math.sign(matching[0].size); // direction of the position to close

        // ---- Market exits from close() / close_all() ----
        if (
            order.type === 'market' &&
            order.profit === undefined &&
            order.loss === undefined &&
            order.limit === undefined &&
            order.stop === undefined &&
            order.trail_price === undefined &&
            order.trail_points === undefined
        ) {
            // Market closes fill in the intrabar phase (after entries) —
            // their interplay with reversal entries is governed by the
            // _intended_trade_ids snapshot above.
            if (phase === 'open') continue;
            // Skip orders placed on the current bar — they fill on the next bar's open.
            if (order.bar >= context.idx) continue;

            // Determine fill price; immediately=true (when supported) would fire
            // at current close; default is current bar's open.
            let fillPrice = order.immediately ? closePrice : openPrice;
            // Apply slippage against the close direction (opposite of position direction).
            fillPrice = applySlippage(context, -matchingDir, fillPrice);

            let qtyToClose = matchingQty;
            if (order.qty && order.qty > 0) qtyToClose = Math.min(order.qty, matchingQty);
            else if (order.qty_percent && order.qty_percent > 0) {
                qtyToClose = matchingQty * (order.qty_percent / 100);
            }

            closeMatching(context, order.from_entry, qtyToClose, fillPrice, currentTime, {
                exitId: order.id,
                exitComment: order.comment,
            });
            order.status = 'filled';
            order.fill_price = fillPrice;
            order.fill_bar = context.idx;
            order.fill_time = currentTime;
            continue;
        }

        // ---- Conditional exits from exit() ----
        // PER-TRADE exit brackets (TV broker-emulator semantics): when a
        // strategy.exit matches multiple open trades (pyramiding), TV
        // creates an independent exit bracket for EACH trade:
        //   - profit / loss (tick) legs compute the trigger from THAT
        //     trade's own entry price;
        //   - limit / stop (absolute price) legs are shared by all trades.
        // When several brackets trigger inside one bar, the fills execute
        // in intra-bar crossing order and each fill closes the OLDEST
        // remaining trades first (FIFO) — NOT necessarily the trade whose
        // bracket computed the level. Verified against the QA pyramiding
        // xlsx (BTCUSDC 1D, 2020-03-12 crash bar: five short TPs filled
        // at five different prices, assigned to trades strictly
        // oldest-first).
        //
        // Trailing legs stay COMPOSITE (one armed peak per order, armed
        // against the weighted-avg entry) — no TV evidence for per-trade
        // trail under pyramiding yet; single-trade behavior is identical
        // either way.
        let totalCost = 0;
        for (const t of matching) totalCost += Math.abs(t.size) * t.entry_price;
        const avgEntry = totalCost / matchingQty;
        const isLong = matchingDir === 1;

        // Shared absolute legs (validated below); per-trade tick legs are
        // computed inside the bracket loop further down.
        let absTp: number | undefined = order.limit;
        let absSl: number | undefined = order.stop;

        // Validate trigger prices are on the correct side of avgEntry —
        // EPHEMERAL pattern only. A wrong-sided leg (e.g. SL below entry
        // for a short, TP above entry for a short) typically arises when
        // the user computes the price from strategy.position_avg_price
        // BEFORE a reversal fill — the value reflects the OUTGOING
        // position. For sparse/ephemeral exits (variable scoped inside
        // an if-block), TV's lazy series-eval gives NA on non-trigger
        // bars → no fire; PT mirrors that by dropping the wrong-sided
        // leg here.
        //
        // For PERSISTENT exits (every-bar refresh, main-scope variable),
        // TV trusts the captured value and lets gap-fill produce the
        // actual reachable price — a stale TP sitting on the wrong side
        // of entry will still fire at the bar's open via gap-fill when
        // the open is past the trigger. Dropping wrong-sided legs here
        // would miss that.
        if (!order._isPersistent) {
            if (absSl !== undefined) {
                const slValid = isLong ? absSl < avgEntry : absSl > avgEntry;
                if (!slValid) absSl = undefined;
            }
            if (absTp !== undefined) {
                const tpValid = isLong ? absTp > avgEntry : absTp < avgEntry;
                if (!tpValid) absTp = undefined;
            }
        }

        // Stale-attachment drop: when the exit was queued at the same bar
        // as the reversal entry it attaches to, the user's absolute
        // limit/stop values were computed from the OUTGOING position's
        // avg. TV's behavior depends on the user's variable scope: if the
        // variable was scoped to an if-block (lazy series eval gives NA
        // on non-trigger bars), TV doesn't fire; if the variable is in
        // main scope (always-defined value), TV fires the captured value.
        //
        // Cadence detection runs at queue time (see exit.ts): the
        // `_isPersistent` flag is set when the user called this same
        // call site on the prior bar (i.e. the strategy.exit line is
        // being re-executed every bar). Persistent capture → trust the
        // value (mirrors TV's main-scope path). Ephemeral capture →
        // drop the absolute legs (mirrors TV's NA-on-non-trigger-bar
        // path for if-block-scoped vars).
        if (order._attachedAtReversal && !order._isPersistent) {
            if (order.limit !== undefined) absTp = undefined;
            if (order.stop !== undefined) absSl = undefined;
        }

        // Trailing-stop state.
        // Two arming modes:
        //   trail_price: armed when market reaches the absolute price level
        //   trail_points: armed when market moves N ticks in favor from entry
        // After arming, ride at trail_offset ticks behind the running peak.
        //
        // Pine semantic: the trail cannot arm and trigger on the same
        // bar. The arming bar establishes the running peak; the trigger
        // check is suppressed for that bar only. SL and TP triggers are
        // independent and still fire on the arming bar.
        // Trail arming + evaluation are intra-bar phenomena — they run in
        // the 'intrabar' phase only (arming twice per bar would corrupt
        // trailArmedThisBar, making the segment model treat the arming bar
        // as an armed-prior bar).
        let trailArmedThisBar = false;
        if (phase === 'intrabar' && !order.trail_armed && (order.trail_price !== undefined || order.trail_points !== undefined)) {
            let armPrice: number | undefined;
            if (order.trail_price !== undefined) armPrice = order.trail_price;
            else if (order.trail_points !== undefined) {
                armPrice = isLong ? avgEntry + order.trail_points * mintick : avgEntry - order.trail_points * mintick;
            }
            if (armPrice !== undefined) {
                const armed = isLong ? highPrice >= armPrice : lowPrice <= armPrice;
                if (armed) {
                    order.trail_armed = true;
                    order.trail_peak = isLong ? highPrice : lowPrice;
                    trailArmedThisBar = true;
                }
            }
        }
        // Peak update is now deferred to checkTrail so we can split it
        // around the intra-bar segment that TV's broker emulator assumes
        // (favorable-first: peak updates BEFORE trigger check;
        //  adverse-first: peak updates AFTER segment-1 check against the
        //  OLD peak's trigger). Eager peak update produced phantom early
        //  fires on adverse-first bars where the bar's high established
        //  the new peak only AFTER the low had already passed.

        // The trail trigger is now computed inside checkTrail's
        // segment branches (using OLD peak for segment 1, NEW peak for
        // segment 3 on adverse-first; new peak unconditionally on
        // favorable-first). See checkTrail below.

        // Evaluate triggers against this bar.
        //
        // TV's intra-bar order assumption — when both TP and SL could've fired,
        // which fires first is determined by the bar's open's PROXIMITY to high
        // vs low (TV docs, "Concepts / Strategies / Broker emulator"):
        //   open closer to HIGH → assumed order: open → high → low → close
        //                         (first move is up — favorable for longs, adverse for shorts)
        //   open closer to LOW  → assumed order: open → low → high → close
        //                         (first move is down — adverse for longs, favorable for shorts)
        //
        // For a long: open-near-high fires TP first, open-near-low fires SL first.
        // For a short: open-near-high fires SL first, open-near-low fires TP first.
        // Trail is treated as an adverse-side trigger (it kicks in on a retrace
        // against the favorable peak), so it fires together with SL.
        const openCloserToHigh = Math.abs(highPrice - openPrice) <= Math.abs(openPrice - lowPrice);
        const favorableFirst = isLong ? openCloserToHigh : !openCloserToHigh;

        // Per-trade bracket evaluation. Each triggered bracket becomes a
        // fill EVENT; events execute in intra-bar crossing order, and each
        // closes the oldest remaining matching trades first (FIFO).
        //
        // Gap-fill rule: if the bar's OPEN is already past a trigger, the
        // fill price is the OPEN, not the literal trigger price. This
        // mirrors real broker behavior — if you'd planned a stop at $100
        // and the bar opens at $95, you fill at $95.
        type FillEvent = { qty: number; price: number; kind: 'profit' | 'loss' | 'trailing'; tradeId?: string };
        const tpEvents: FillEvent[] = [];
        const slEvents: FillEvent[] = [];

        // Margin-call bracket lock: after a same-bar margin call, only the
        // bracket of the lot the MC partially consumed stays working for
        // the rest of the bar — the other lots' brackets are canceled and
        // re-created by the next strategy.exit call (see processMarginCall
        // for the QA evidence).
        const mcLock = (strategy as any)._mc_exit_lock;
        const mcLocked = mcLock && mcLock.bar === context.idx;

        for (const t of matching) {
            if (mcLocked && t.id !== mcLock.tradeId) continue;
            // Tick legs compute from the lot's PHYSICAL entry — immutable
            // under FIFO ledger pairing (see closePartialPosition).
            const entry = t._bracket_entry ?? t.entry_price;
            const tQty = Math.abs(t.size);
            let tp = absTp;
            if (tp === undefined && order.profit !== undefined) {
                tp = isLong ? entry + order.profit * mintick : entry - order.profit * mintick;
            }
            let sl = absSl;
            if (sl === undefined && order.loss !== undefined) {
                sl = isLong ? entry - order.loss * mintick : entry + order.loss * mintick;
            }

            // In the pre-entry 'open' phase only GAP conditions count (the
            // bar opened already past the trigger); intra-bar crossings
            // belong to the 'intrabar' phase.
            const tpHit =
                tp !== undefined && (phase === 'open' ? (isLong ? openPrice >= tp : openPrice <= tp) : isLong ? highPrice >= tp : lowPrice <= tp);
            const slHit =
                sl !== undefined && (phase === 'open' ? (isLong ? openPrice <= sl : openPrice >= sl) : isLong ? lowPrice <= sl : highPrice >= sl);

            // OCO per trade: when both legs are reachable within the bar,
            // the leg crossed FIRST along the assumed intra-bar path wins
            // (favorable-first → TP, adverse-first → SL).
            let kind: 'profit' | 'loss' | null = null;
            if (tpHit && slHit) kind = favorableFirst ? 'profit' : 'loss';
            else if (tpHit) kind = 'profit';
            else if (slHit) kind = 'loss';

            if (kind === 'loss') {
                const openPastSl = isLong ? openPrice <= (sl as number) : openPrice >= (sl as number);
                // TV asymmetry (637-event census from the gap_precedence
                // probe, BTCUSDT 1D): a BUY-stop — the SL leg of a SHORT
                // position — that is already in-the-money at the open does
                // NOT catch a trade that entered at that same open
                // (spared 234/234), while sell-stops and both-side limits
                // always catch (403/403). Suppress the stop leg for
                // same-bar short entries gapped past at the open; the TP
                // leg (if also reachable) still applies.
                const buyStopSparesFreshEntry = !isLong && openPastSl && t.entry_bar_index === context.idx;
                if (!buyStopSparesFreshEntry) {
                    slEvents.push({ qty: tQty, price: openPastSl ? openPrice : (sl as number), kind: 'loss', tradeId: t.id });
                } else if (tpHit) {
                    kind = 'profit';
                }
            }
            if (kind === 'profit') {
                const openPastTp = isLong ? openPrice >= (tp as number) : openPrice <= (tp as number);
                tpEvents.push({ qty: tQty, price: openPastTp ? openPrice : (tp as number), kind: 'profit', tradeId: t.id });
            }
        }

        // Crossing order within each leg: the TP leg is crossed while
        // price travels toward the FAVORABLE extreme (ascending prices for
        // a long, descending for a short); the SL leg while traveling
        // toward the ADVERSE extreme (the reverse). Gap-fills carry
        // price = open and naturally sort to the front of their leg.
        tpEvents.sort((a, b) => (isLong ? a.price - b.price : b.price - a.price));
        slEvents.sort((a, b) => (isLong ? b.price - a.price : a.price - b.price));
        // Composite trailing leg — same intra-bar segment model as before
        // (TV broker emulator), emitting an event for the REMAINING qty
        // instead of firing directly:
        //
        // Favorable-first (open closer to high for long; open closer to
        // low for short):
        //   Phase 1: open → favorable extreme (price rides to bar H for
        //            long / bar L for short). Peak updates to that.
        //   Phase 2: favorable extreme → adverse extreme. Trigger
        //            (= NEW peak ± offset) may be crossed.
        //   Phase 3: adverse extreme → close. (Already covered.)
        //
        // Adverse-first (open closer to adverse extreme):
        //   Phase 1: open → adverse extreme. Peak is still PRIOR. Check
        //            trigger using OLD peak; if crossed, fire there.
        //   Phase 2: adverse → favorable extreme. Peak updates now.
        //   Phase 3: favorable → close. If close descends/rises
        //            through the NEW trigger, fire at the NEW trigger.
        //
        // Arming THIS bar is a sub-case: the peak was JUST established
        // at the arming moment (bar's H for long / L for short). The
        // segment-1 check with OLD peak doesn't apply (trail wasn't
        // armed yet). Only phase 2 (favorable-first) or phase 3
        // (adverse-first) can fire on the arming bar.
        //
        // The fill is always the LITERAL trigger price — gap-fill at
        // open is incorrect for trail (the bar's open precedes any
        // peak update for this trade).
        let trailEvent: FillEvent | null = null;
        if (phase === 'intrabar' && !mcLocked && order.trail_armed && order.trail_offset !== undefined) {
            const updatePeak = () => {
                if (isLong) order.trail_peak = Math.max(order.trail_peak ?? -Infinity, highPrice);
                else order.trail_peak = Math.min(order.trail_peak ?? Infinity, lowPrice);
            };
            const triggerFromPeak = (): number =>
                isLong
                    ? (order.trail_peak as number) - (order.trail_offset as number) * mintick
                    : (order.trail_peak as number) + (order.trail_offset as number) * mintick;
            const emitTrail = (price: number) => {
                trailEvent = { qty: Infinity, price, kind: 'trailing' };
            };

            if (trailArmedThisBar) {
                // Peak is already the bar's favorable extreme (set by the
                // arming logic). Don't update again.
                const trig = triggerFromPeak();
                if (favorableFirst) {
                    // Phase 2 (favorable extreme → adverse extreme): low for
                    // long / high for short crosses trigger.
                    const hit = isLong ? lowPrice <= trig : highPrice >= trig;
                    if (hit) emitTrail(trig);
                } else {
                    // Phase 3 (favorable extreme → close): close past trigger.
                    const seg3 = isLong ? closePrice <= trig : closePrice >= trig;
                    if (seg3) emitTrail(trig);
                }
            } else if (favorableFirst) {
                // Already armed in a prior bar. Full segment model.
                updatePeak();
                const trig = triggerFromPeak();
                const hit = isLong ? lowPrice <= trig : highPrice >= trig;
                if (hit) emitTrail(trig);
            } else {
                const oldTrig = triggerFromPeak();
                const seg1 = isLong ? lowPrice <= oldTrig : highPrice >= oldTrig;
                if (seg1) {
                    emitTrail(oldTrig);
                } else {
                    updatePeak();
                    const newTrig = triggerFromPeak();
                    const seg3 = isLong ? closePrice <= newTrig : closePrice >= newTrig;
                    if (seg3) emitTrail(newTrig);
                }
            }
        }

        // Path-ordered event list (mirrors the old checkTp/checkSl/
        // checkTrail priority: TP leg first on favorable-first bars;
        // SL then trail then TP on adverse-first bars).
        const events: FillEvent[] = favorableFirst
            ? [...tpEvents, ...slEvents, ...(trailEvent ? [trailEvent] : [])]
            : [...slEvents, ...(trailEvent ? [trailEvent] : []), ...tpEvents];

        if (events.length > 0) {
            // qty / qty_percent caps apply to the TOTAL closed by this order.
            let capRemaining = matchingQty;
            if (order.qty && order.qty > 0) capRemaining = Math.min(order.qty, matchingQty);
            else if (order.qty_percent && order.qty_percent > 0) {
                capRemaining = matchingQty * (order.qty_percent / 100);
            }

            const remainingMatchingQty = () =>
                strategy.opentrades.filter((t) => !order.from_entry || t.entry_id === order.from_entry).reduce((sum, t) => sum + Math.abs(t.size), 0);

            let lastFill = NaN;
            let closedAny = false;
            for (const ev of events) {
                if (capRemaining <= 1e-9) break;
                const remaining = remainingMatchingQty();
                if (remaining <= 1e-9) break;
                const qtyThis = Math.min(ev.qty === Infinity ? remaining : ev.qty, capRemaining, remaining);
                // Apply slippage to the trigger price (closing side direction).
                const fillPrice = applySlippage(context, -matchingDir, ev.price);

                // Resolve which per-leg comment to stamp on the closed
                // trade. strategy.exit() exposes comment_profit /
                // comment_loss / comment_trailing — each fires only when
                // its leg triggers. Fall back to the generic `comment`.
                const legComment =
                    ev.kind === 'profit'
                        ? (order.comment_profit ?? order.comment)
                        : ev.kind === 'loss'
                          ? (order.comment_loss ?? order.comment)
                          : (order.comment_trailing ?? order.comment);

                // Bracket fills close their SOURCE lot (per-lot binding);
                // the trail event has no source lot and closes FIFO.
                closeMatching(
                    context,
                    order.from_entry,
                    qtyThis,
                    fillPrice,
                    currentTime,
                    {
                        triggerKind: ev.kind,
                        exitId: order.id,
                        exitComment: legComment,
                    },
                    ev.tradeId,
                );
                capRemaining -= qtyThis;
                lastFill = fillPrice;
                closedAny = true;
            }

            // The order is consumed when nothing matching remains open or
            // its qty cap is exhausted; otherwise it stays pending so the
            // surviving trades' brackets remain active on later bars (TV
            // brackets persist until filled or replaced).
            if (closedAny && (remainingMatchingQty() <= 1e-9 || capRemaining <= 1e-9)) {
                order.status = 'filled';
                order.fill_price = lastFill;
                order.fill_bar = context.idx;
                order.fill_time = currentTime;
            }
        }
    }

    // Remove filled/cancelled exit orders.
    strategy.pending_orders = strategy.pending_orders.filter((o) => o.status === 'pending');

    // Refresh equity for any caller reading metrics between processExitOrders
    // and the bar-finalize step. Peaks are latched in finalizeBar().
    markToMarket(context, closePrice);
}


/**
 * True when the bar's first intra-bar move is ADVERSE for the current
 * position (TV broker-emulator path assumption: open closer to high →
 * open→high→low→close; open closer to low → open→low→high→close).
 * Used to path-order the margin-call checkpoint against exit fills.
 */
export function isAdverseFirstBar(context: any): boolean {
    const strategy: StrategyState = context.strategy;
    const dir = Math.sign(strategy?.position_size ?? 0);
    if (dir === 0) return false;
    const openPrice = Series.from(context.data.open).get(0);
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const openCloserToHigh = Math.abs(highPrice - openPrice) <= Math.abs(openPrice - lowPrice);
    return dir === 1 ? !openCloserToHigh : openCloserToHigh;
}
