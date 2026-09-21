# PineOrca

PineOrca is a high-performance Pine Script v5/v6 execution engine, backtesting platform, and WebGL2 financial charting workspace. It provides TradingView parity for custom technical indicators and complex algorithmic strategies directly in modern web runtimes.

## Monorepo Architecture

PineOrca is organized as an npm workspaces monorepo separating presentation, visualization, columnar data structures, typed worker RPC, and the computational calculation engine across distinct packages:

| Package | Directory | License | Role |
|---|---|---|---|
| `@pineorca/shell` | [`packages/shell`](packages/shell) | Apache-2.0 | Application container, routing, and Web Worker host |
| `@pineorca/chart` | [`packages/chart`](packages/chart) | Apache-2.0 | WebGL2 multi-pane financial charting adapter and trade overlays |
| `@pineorca/ui` | [`packages/ui`](packages/ui) | Apache-2.0 | Monaco Pine Script editor, Strategy Tester, and dockable panels |
| `@pineorca/data` | [`packages/data`](packages/data) | Apache-2.0 | Struct-of-arrays columnar market data buffers and storage |
| `@pineorca/worker-bridge` | [`packages/worker-bridge`](packages/worker-bridge) | Apache-2.0 | Typed RPC transport and Transferable buffer multiplexing |
| `@pineorca/engine-pinets` | [`packages/engine-pinets`](packages/engine-pinets) | AGPL-3.0-only | Pine Script v5/v6 transpiler, series runtime, and broker emulator |

For detailed system design and subsystem boundaries, see [`docs/index.md`](docs/index.md) and [`docs/architecture.md`](docs/architecture.md).

## Quickstart

Executable workflows are configured in [`package.json`](package.json):

- **Start local development server:**
  ```bash
  npm run dev
  ```
  Launches Vite for `@pineorca/shell` at `http://localhost:5173` with proxy routing for market data providers.

- **Run test suites:**
  ```bash
  npm test
  ```
  Executes unit, integration, and parity test suites across all packages via Vitest.

- **Typecheck monorepo:**
  ```bash
  npm run typecheck
  ```
  Builds and verifies TypeScript declarations across all workspace packages via project references.

Operational setup and environment details are documented in [`docs/development.md`](docs/development.md).

## Licensing Model

PineOrca enforces a strict licensing boundary between permissive client packages and the copyleft engine:

- **Host & Client Packages (Apache-2.0):** Shell, charting, UI components, columnar data storage, and the worker bridge client are released under Apache-2.0.
- **Execution Engine (AGPL-3.0-only):** The Pine Script transpilation pipeline, calculation series, and broker simulation engine are licensed under AGPL-3.0-only.
- **Process Isolation Seam:** The engine runs exclusively inside an isolated Web Worker spawned by [`packages/shell/src/worker/engine.worker.ts`](packages/shell/src/worker/engine.worker.ts). Permissive packages maintain zero direct runtime dependencies on the engine, communicating exclusively across typed RPC via [`packages/worker-bridge`](packages/worker-bridge). This boundary is enforced by automated test suites in [`packages/shell/test/licensing-boundary.test.ts`](packages/shell/test/licensing-boundary.test.ts).

See [`docs/architecture.md`](docs/architecture.md#licensing-boundary) for the complete legal isolation contract.

## Documentation

- [Documentation Index](docs/index.md)
- [Architecture & Design Decisions](docs/architecture.md)
- [Development & Verification Guide](docs/development.md)
