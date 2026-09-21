// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export interface StrategyPreset {
  name: string;
  code: string;
}

export const STRATEGY_PRESETS: Record<string, StrategyPreset> = {
  sma_cross: {
    name: 'SMA Cross (Fast/Slow)',
    code: `//@version=5
strategy("SMA Cross Strategy", overlay=true, initial_capital=100000, default_qty_type=strategy.percent_of_equity, default_qty_value=20)

fastLength = input.int(10, "Fast Length")
slowLength = input.int(30, "Slow Length")

fastSMA = ta.sma(close, fastLength)
slowSMA = ta.sma(close, slowLength)

plot(fastSMA, "Fast SMA", color=color.blue)
plot(slowSMA, "Slow SMA", color=color.orange)

if (ta.crossover(fastSMA, slowSMA))
    strategy.entry("Long", strategy.long)

if (ta.crossunder(fastSMA, slowSMA))
    strategy.close("Long")
`,
  },
  rsi_divergence: {
    name: 'RSI Reversal Strategy',
    code: `//@version=5
strategy("RSI Reversal", overlay=true, initial_capital=100000, default_qty_type=strategy.percent_of_equity, default_qty_value=25)

rsiLength = input.int(14, "RSI Length")
oversold = input.int(30, "Oversold")
overbought = input.int(70, "Overbought")

vrsi = ta.rsi(close, rsiLength)

if (ta.crossover(vrsi, oversold))
    strategy.entry("RSI_Long", strategy.long)

if (ta.crossunder(vrsi, overbought))
    strategy.close("RSI_Long")
`,
  },
  bollinger_breakout: {
    name: 'Bollinger Bands Breakout',
    code: `//@version=5
strategy("Bollinger Bands Breakout", overlay=true, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1)

length = input.int(20, "Length")
mult = input.float(2.0, "Multiplier")

basis = ta.sma(close, length)
dev = mult * ta.stdev(close, length)
upper = basis + dev
lower = basis - dev

plot(upper, "Upper Band", color=color.red)
plot(basis, "Basis", color=color.gray)
plot(lower, "Lower Band", color=color.green)

if (close > upper)
    strategy.entry("BB_Long", strategy.long)

if (close < basis)
    strategy.close("BB_Long")
`,
  },
};
