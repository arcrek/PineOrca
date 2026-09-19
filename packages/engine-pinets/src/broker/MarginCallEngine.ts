// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import { StrategyState } from '../namespaces/strategy/types';
import { Series } from '../Series';
import { parseDirection, ledgerOpenLots, closePartialPosition } from './FIFOLedger';



/**
 * Margin required to hold a position of `qty` contracts at `price`, given
 * the `marginPct` (% of notional that must be posted as collateral). The
 * pointValue factor converts price units to account-currency dollars
 * (1 for crypto, varies for futures).
 *
 * Pine docs (strategy() declaration): `margin_long` / `margin_short` is
 * the percentage of notional held as collateral. 100 = no leverage, 20 =
 * 5× leverage, etc.
 */
export function computeRequiredMargin(qty: number, price: number, marginPct: number, pointValue: number): number {
    return (Math.abs(qty) * price * pointValue * marginPct) / 100;
}


/**
 * Account equity computed AS IF the marketprice were `atPrice` — used to
 * check what equity would be at a hypothetical intra-bar price (e.g. the
 * bar's adverse extreme for a margin-call check).
 *
 *   equity_at_price = initial_capital + netprofit + unrealizedPnL_at_price
 *
 * The mark-to-market is computed against EVERY open trade's entry price.
 */
export function computeEquityAtPrice(context: any, atPrice: number): number {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let unrealized = 0;
    for (const lot of ledgerOpenLots(strategy)) {
        const priceChange = lot.dir === 1 ? atPrice - lot.entry_price : lot.entry_price - atPrice;
        unrealized += priceChange * lot.qty * pointValue;
    }
    return strategy.initial_capital + strategy.netprofit + unrealized;
}


/**
 * Total margin currently held by all open positions, valued at `atPrice`.
 * Per-position margin uses `margin_long` for longs and `margin_short` for
 * shorts (Pine semantic — see strategy() declaration).
 */
export function computeHeldMargin(context: any, atPrice: number): number {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let total = 0;
    for (const trade of strategy.opentrades) {
        const dir = Math.sign(trade.size);
        const marginPct = dir === 1 ? (strategy.config.margin_long ?? 100) : (strategy.config.margin_short ?? 100);
        total += computeRequiredMargin(trade.size, atPrice, marginPct, pointValue);
    }
    return total;
}


/**
 * Apply a SECOND margin call scheduled by the phantom re-check (see
 * processMarginCall). TV books that fill at the PREVIOUS bar's close,
 * AFTER the script's on-close evaluation — so the script and any order
 * it queued saw the pre-MC#2 position. PineTS mirrors this by booking
 * the fill at the very start of the NEXT bar, before entries process:
 * a reversal queued at the MC bar's close (qty frozen at queue time)
 * then naturally overshoots by exactly q2, reproducing TV's phantom
 * opposite-side position (xlsx-confirmed: 2021-10-02 reversal long
 * 5.263108 = 5 + 0.263108).
 *
 * Same-direction (non-reversal) entries queued on the MC bar are
 * CANCELED — TV's transient post-MC state rejects them (2022-04-19: the
 * add queued at the 04-18 close never filled; the next add was accepted
 * a bar later). Opposite-direction reversals are unaffected (E1), and a
 * close-MC that flattens the position leaves nothing to gate (IC=900k
 * experiment: next-open entry from flat was admitted).
 */
export function applyPendingCloseMarginCall(context: any): void {
    const strategy: StrategyState = context.strategy;
    if (!strategy) return;
    const pending = (strategy as any)._pending_close_mc;
    if (!pending) return;
    (strategy as any)._pending_close_mc = null;

    if (strategy.opentrades.length === 0 || Math.sign(strategy.position_size) !== pending.dir) return;

    closePartialPosition(context, Math.min(pending.qty, Math.abs(strategy.position_size)), pending.price, pending.time, {
        exitId: 'Margin call',
        exitComment: 'Margin call',
    });

    if (Math.abs(strategy.position_size) > 1e-9) {
        for (const o of strategy.pending_orders) {
            if (o.status === 'pending' && (o.category ?? 'entry') === 'entry' && !o._isReversalEntry && parseDirection(o.direction) === pending.dir) {
                o.status = 'cancelled';
            }
        }
        strategy.pending_orders = strategy.pending_orders.filter((o) => o.status === 'pending');
    }
}


/**
 * Margin-call check (TV broker emulator) at one of two intra-bar
 * CHECKPOINTS along the assumed price path:
 *
 *   'open'    — right after entries fill at the bar's open: equity and
 *               required margin evaluated AT THE OPEN, liquidation fills
 *               at the open price.
 *   'extreme' — at the bar's adverse extreme (low for longs, high for
 *               shorts), liquidation fills at the extreme itself — the
 *               pessimistic broker model (intra-bar tick order unknown).
 *   'close'   — at the bar's close, after all exits: if the (possibly
 *               already-trimmed) position still breaches at the closing
 *               price, another partial liquidation fills at the close.
 *               Evidence: 2021-10-01 (profit QA) shows TWO same-bar MC
 *               prices — 4×cover at the high, then a further 0.263108
 *               at 48,147.38 (the close).
 *
 * TV checks margin along the path, interleaved with exit fills — proven
 * by the MC-ordering probe (BTCUSDT 1D, 2026-02-05): a 5-lot short
 * entered at the open was split within one bar into MC 0.00228 at the
 * OPEN price, MC 0.0888 at the high, then a TP fill of 4.90892 at the
 * lows. The caller orders the 'extreme' checkpoint BEFORE exit
 * processing on adverse-first bars and AFTER it on favorable-first bars
 * (favorable exits free margin before the adverse extreme is reached).
 *
 * Runs for ALL margin percentages including 100%. At 100% margin the
 * trader still needs full notional collateral; adverse price movement
 * that drops account equity below the position's current notional
 * triggers a margin call. This matches TV's broker-emulator behavior
 * (the "Margin calls" stat in the Strategy Tester is non-zero on 100%
 * margin runs whenever a position's mark-to-market loss exceeds equity).
 */
export function processMarginCall(context: any, checkpoint: 'open' | 'extreme' | 'close' = 'extreme'): void {
    const strategy: StrategyState = context.strategy;
    if (!strategy || strategy.opentrades.length === 0) return;

    const positionDir = Math.sign(strategy.position_size);
    if (positionDir === 0) return;

    const marginPct = positionDir === 1 ? (strategy.config.margin_long ?? 100) : (strategy.config.margin_short ?? 100);

    const openPrice = Series.from(context.data.open).get(0);
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const closePrice = Series.from(context.data.close).get(0);
    const currentTime = Series.from(context.data.openTime).get(0);
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;

    const adversePrice = checkpoint === 'open' ? openPrice : checkpoint === 'close' ? closePrice : positionDir === 1 ? lowPrice : highPrice;
    const totalQty = Math.abs(strategy.position_size);
    const equityAtAdverse = computeEquityAtPrice(context, adversePrice);
    const requiredMarginAtAdverse = computeRequiredMargin(totalQty, adversePrice, marginPct, pointValue);

    if (equityAtAdverse < requiredMarginAtAdverse) {
        // PARTIAL liquidation (TV broker-emulator rule): compute the margin
        // deficit at the adverse extreme, convert it to contracts at that
        // price, and liquidate 4× that amount — the 4× buffer prevents the
        // trimmed position from being immediately margin-called again on
        // the next tick. The remainder of the position stays open. Capped
        // at the full position size for catastrophic deficits.
        //
        // Verified against TV xlsx exports (MACD/BTCUSDT 1D, 100% margin):
        // TV liquidated 1.21312 of a 5-contract short (deficit $33,603.64
        // at price 110,797.38 → 4 × 0.30328) and 0.48244 of another
        // (deficit $10,924.98 at 90,574.00 → 4 × 0.12061).
        const deficit = requiredMarginAtAdverse - equityAtAdverse;
        // Full-precision cover — no truncation. Verified against the
        // commission-0 margin oracle (BTCUSDC weekly) where TV's
        // liquidation qty matches PT's untruncated 4× cover exactly, and
        // against the BTCUSDC avg_price QA xlsx (TV qty 3.602232 ≈ 7
        // significant digits). An earlier 5-decimal floor was overfit to
        // the BTCUSDT margin_calls xlsx where TV's exported quantities
        // (1.21312, 0.48244) are 7-significant-digit values with trailing
        // zeros trimmed; the residual there (~$1 equity-basis opacity
        // inside TV) is sub-dollar on a $530k net and accepted.
        //
        // The marginPct/100 divisor matters below 100%: TV liquidates
        // 4×deficit/(price·m) — verified exactly on fresh TV captures at
        // margin_long/short = 50 (close-MC investigation, 2026-06-12).
        const marginFrac = marginPct / 100;
        const coverQty = deficit / (adversePrice * pointValue * marginFrac);
        const qtyToLiquidate = Math.min(totalQty, 4 * coverQty);

        // Remember the FIFO order before the close so we can identify the
        // PARTIALLY-consumed lot afterwards (the liquidation eats whole
        // lots from the front; the first lot still open afterwards is the
        // one it bit into).
        const fifoBefore = [...strategy.opentrades];
        const frontPiece = fifoBefore[0];
        const frontQty = Math.abs(frontPiece.size);
        const frontEntry = frontPiece.entry_price;

        closePartialPosition(context, qtyToLiquidate, adversePrice, currentTime, {
            exitId: 'Margin call',
            exitComment: 'Margin call',
        });

        // ---- Phantom re-check → SECOND margin call at the bar's CLOSE ----
        // TV broker-emulator behavior (reverse-engineered 2026-06-12,
        // exact on 6 TV-captured events incl. margin=50% and full-cap
        // variants; 122+ negative controls): when the margin call closed
        // the FIRST (oldest) FIFO piece ENTIRELY, TV re-evaluates the
        // margin condition in a transient state where that piece's margin
        // is freed and its unrealized PnL removed from equity, but its
        // realized PnL has NOT yet been booked. The residual deficit is
        //   D2 = D1 − p1·(p·m·pv) + u1,   u1 = p1·(p − e1)·dir·pv
        // (p1/e1 = first piece qty/entry, p = the adverse checkpoint
        // price, dir = +1 long / −1 short). If D2 > 0, a second margin
        // call q2 = min(remaining, 4·trunc6(D2/(p·m·pv))) fires — FILLED
        // AT THE BAR'S CLOSE and booked AFTER the script's on-close
        // evaluation, so the script (and any order it queues this bar)
        // still sees the pre-MC#2 position. A reversal queued at that
        // close therefore overshoots by exactly q2 on the next bar (TV
        // xlsx 2021-10-02: reversal long 5.263108 = 5 + q2). Application
        // is deferred to the start of the next bar via
        // `_pending_close_mc` (see applyPendingCloseMarginCall).
        //
        // Single-piece margin calls can never fire this (D2 < 0
        // algebraically) — only calls that consume the whole front piece
        // and span into deeper lots qualify, and even then rarely.
        if (checkpoint === 'extreme' && qtyToLiquidate >= frontQty - 1e-9 && Math.abs(strategy.position_size) > 1e-9) {
            const freedMargin = computeRequiredMargin(frontQty, adversePrice, marginPct, pointValue);
            const u1 = frontQty * (adversePrice - frontEntry) * positionDir * pointValue;
            const d2 = deficit - freedMargin + u1;
            if (d2 > 0) {
                const closeP = Series.from(context.data.close).get(0);
                const trunc6 = (x: number) => Math.trunc(x * 1e6) / 1e6;
                const cover2 = trunc6(d2 / (adversePrice * pointValue * marginFrac));
                const q2 = Math.min(Math.abs(strategy.position_size), 4 * cover2);
                if (q2 > 1e-9) {
                    (strategy as any)._pending_close_mc = {
                        qty: q2,
                        price: closeP,
                        time: currentTime,
                        dir: positionDir,
                    };
                }
            }
        }

        // TV broker-emulator rule (QA evidence): a margin call CANCELS all
        // working exit brackets for the rest of the bar EXCEPT the bracket
        // of the lot it partially consumed. The canceled lots get fresh
        // brackets from the next strategy.exit call (next bar).
        // Evidence: 2024-08-03 (avg_price QA) — after MC 0.59552 at the
        // high, the shared TP at 59,954 filled ONLY the touched lot's
        // remainder 4.40448; the other covered lot exited next day at the
        // refreshed level. Same split on 2021-05-16 (profit QA: only the
        // MC-touched lot's TP filled same-bar, untouched lots filled next
        // day at their own levels) and on the MC-probe triple bar
        // 2026-02-05 (the only lot was the touched one → its TP filled).
        const survivor = fifoBefore.find((t) => t.status === 'open');
        (strategy as any)._mc_exit_lock = { bar: context.idx, tradeId: survivor?.id ?? null };
    }
}
