# PineOrca Documentation

PineOrca provides a high-performance Pine Script v5/v6 runtime, TradingView-parity strategy backtesting, and a WebGL2 financial charting interface.

## Documentation Navigation

The documentation is organized across targeted authority surfaces:

- **[Architecture & System Design](architecture.md):** Inviolable licensing boundary, zero-copy columnar memory layouts, two-stage AST transpilation, broker emulation kernel, and market data architecture.
- **[Development & Verification](development.md):** Local execution setup, proxy configuration, workspace test runners, TypeScript validation, and licensing seam enforcement tests.

## Monorepo Package Inventory

The repository is organized into six workspace packages with distinct responsibilities and executable owners:

| Package | Path | License | Executable Manifest | Core Entry Point |
|---|---|---|---|---|
| `@pineorca/shell` | `packages/shell` | Apache-2.0 | [`packages/shell/package.json`](../packages/shell/package.json) | [`packages/shell/src/main.ts`](../packages/shell/src/main.ts) |
| `@pineorca/chart` | `packages/chart` | Apache-2.0 | [`packages/chart/package.json`](../packages/chart/package.json) | [`packages/chart/src/index.ts`](../packages/chart/src/index.ts) |
| `@pineorca/ui` | `packages/ui` | Apache-2.0 | [`packages/ui/package.json`](../packages/ui/package.json) | [`packages/ui/src/index.ts`](../packages/ui/src/index.ts) |
| `@pineorca/data` | `packages/data` | Apache-2.0 | [`packages/data/package.json`](../packages/data/package.json) | [`packages/data/src/index.ts`](../packages/data/src/index.ts) |
| `@pineorca/worker-bridge` | `packages/worker-bridge` | Apache-2.0 | [`packages/worker-bridge/package.json`](../packages/worker-bridge/package.json) | [`packages/worker-bridge/src/index.ts`](../packages/worker-bridge/src/index.ts) |
| `@pineorca/engine-pinets` | `packages/engine-pinets` | AGPL-3.0-only | [`packages/engine-pinets/package.json`](../packages/engine-pinets/package.json) | [`packages/engine-pinets/src/index.ts`](../packages/engine-pinets/src/index.ts) |

For root workspace orchestration and command scripts, see [`package.json`](../package.json).
