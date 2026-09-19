---
phase: 3
title: "Broker Emulator & TradingView Parity Engine"
status: completed
priority: P1
effort: "7d"
dependencies: ["2"]
---

# Phase 3: Broker Emulator & TradingView Parity Engine

## Goal
Port and harden the 2,301-line broker engine (`strategy/utils.ts`), verifying exact parity with TradingView's execution engine for order matching, FIFO lot liquidation, gap fills, intrabar polarity, trailing stops, and multi-checkpoint margin calls.

## Files to Create / Modify
- Create: `packages/engine-pinets/src/broker/OrderMatcher.ts` (Order execution and mintick grid snapping away from reference price)
- Create: `packages/engine-pinets/src/broker/IntrabarSimulator.ts` (Intrabar price path generator and `isAdverseFirstBar` polarity check)
- Create: `packages/engine-pinets/src/broker/FIFOLedger.ts` (FIFO lot queues: physical `opentrades` vs accounting `_ledger_entries`, pro-rata commissions)
- Create: `packages/engine-pinets/src/broker/MarginCallEngine.ts` (3-checkpoint margin evaluator with 4× deficit cover liquidation)
- Create: `packages/engine-pinets/src/broker/MetricsCalculator.ts` (30+ statistics: Net Profit, Sharpe, Sortino, CAGR, Drawdown, Win Rate)
- Create: `packages/engine-pinets/src/broker/StrategyKernel.ts` (Unified bar execution loop driving order fills, script ticks, and equity latching)
- Create: `packages/engine-pinets/test/broker-parity.test.ts` (Comprehensive order matching and FIFO liquidation test suite)
- Create: `packages/engine-pinets/test/margin-calls.test.ts` (Margin liquidation and 4x deficit cover test suite)

## Tasks & Steps
1. **Order Precedence & Mintick Grid Snapping**:
   - Port `roundToMintick` pushing stop/limit prices conservatively away from reference price (`ceil` for prices above reference, `floor` for prices below reference).
   - Implement two-phase order execution: orders queued on bar $N$ evaluate for execution at bar $N+1$ open.
   - Replicate TradingView's buy-stop same-open gap asymmetry (`strategy/utils.ts:1515-1524`).
2. **Intrabar Polarity & Exit Bracket Evaluation**:
   - Implement `isAdverseFirstBar`: if $|H - O| \le |O - L|$, adverse extreme checkpoint evaluates *before* exit orders; otherwise exit orders evaluate first.
   - Implement per-trade exit brackets (`profit`, `loss`, `trail_price`, `trail_points`) tethered to each trade lot's immutable `_bracket_entry` price.
   - Maintain composite trailing-stop high/low watermarks (`trail_peak`).
3. **FIFO Ledger Slicing & Commission Accounting**:
   - Enforce decoupling between physical trade lots (`opentrades`) and FIFO accounting ledger rows (`closedtrades`).
   - Split closing orders across multiple prior entry lots in chronological order (oldest first).
   - Apportion entry commissions pro-rata upon partial closes.
4. **Multi-Checkpoint Margin Engine**:
   - Evaluate margin requirements at `open`, `extreme`, and `close`.
   - On margin breach, calculate deficit: $\text{Deficit} = \text{Required Margin} - \text{Equity}$.
   - Liquidate contracts using the 4× deficit cover buffer formula: $\text{Liquidate Qty} = \min\left(|\text{Size}|, \frac{4 \times \text{Deficit}}{\text{Price} \times \text{PointValue}}\right)$.
5. **Statistical Metrics Formulation**:
   - Calculate all 30+ TradingView metrics: Sharpe, Sortino, CAGR, Drawdown %, Runup %, Profit Factor, Expectancy, and Average Trade.

## Verification
- `npx vitest run packages/engine-pinets/test/broker-parity.test.ts`
  - *Pass criteria*: Zero mismatches in closed trade counts, fill prices, and realized PnL against TradingView reference scripts.
- `npx vitest run packages/engine-pinets/test/margin-calls.test.ts`
  - *Pass criteria*: Matches TradingView BTCUSDT 1D leveraged liquidation bar index, liquidation quantity, and remaining balance.
