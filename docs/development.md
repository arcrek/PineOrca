# PineOrca Development Guide

This guide describes operational workflows, testing practices, and core engineering constraints for working within the PineOrca monorepo.

## Development Workflow

Monorepo scripts are declared in the root [`package.json`](../package.json).

### Running Local Development Environment

To start the local development workspace:

```bash
npm run dev
```

This command invokes the `@pineorca/shell` dev script defined in [`packages/shell/package.json`](../packages/shell/package.json), launching a Vite server:

- **Host & Port:** `http://localhost:5173` (configured in [`packages/shell/vite.config.ts`](../packages/shell/vite.config.ts)).
- **Web Worker Bundling:** Vite bundles the isolated engine worker [`packages/shell/src/worker/engine.worker.ts`](../packages/shell/src/worker/engine.worker.ts) as an ES module (`format: 'es'`).
- **Market Data Proxy:** The Vite dev server proxies requests under `/api/yahoo` to `https://query1.finance.yahoo.com` with header rewrites, avoiding browser CORS blocks when loading historical quotes for equities and forex.

## Testing & Verification

All automated tests run through the monorepo workspace test scripts.

### Running Test Suites

```bash
npm test
```

Executes test files matching `packages/*/test/**/*.test.ts` via Vitest. The configuration in [`vitest.config.ts`](../vitest.config.ts) resolves TypeScript source aliases and handles environment virtualization (such as fake IndexedDB).

### Type Checking

```bash
npm run typecheck
```

Builds and type-checks the entire monorepo using TypeScript project references defined in [`tsconfig.json`](../tsconfig.json).

### Licensing Boundary Verification

PineOrca enforces an automated boundary check to prevent copyleft AST leaks or dependencies from infecting permissive packages:

```bash
npx vitest run packages/shell/test/licensing-boundary.test.ts
```

Defined in [`packages/shell/test/licensing-boundary.test.ts`](../packages/shell/test/licensing-boundary.test.ts), this test:

1. Validates that package manifests for `@pineorca/shell`, `@pineorca/chart`, `@pineorca/ui`, and `@pineorca/worker-bridge` declare `Apache-2.0` and contain zero runtime dependencies on `@pineorca/engine-pinets`.
2. Recursively scans all TypeScript source files across permissive packages to verify that no file (other than the designated bridge [`packages/shell/src/worker/engine.worker.ts`](../packages/shell/src/worker/engine.worker.ts)) imports `@pineorca/engine-pinets`.

## Engineering Constraints

Contributors and automated agents must adhere to the following architectural rules:

### 1. Inviolable Licensing Seam

- **No Direct Imports:** Code in `packages/shell`, `packages/chart`, `packages/ui`, `packages/data`, or `packages/worker-bridge` must never directly import `@pineorca/engine-pinets`.
- **Worker Bridge Boundary:** Main-thread code communicates with the calculation engine exclusively by dispatching typed commands via [`packages/worker-bridge/src/WorkerBridge.ts`](../packages/worker-bridge/src/WorkerBridge.ts).
- **Sole Bridge File:** The only file permitted to import `@pineorca/engine-pinets` within the host package tree is [`packages/shell/src/worker/engine.worker.ts`](../packages/shell/src/worker/engine.worker.ts).

### 2. Zero-Copy Memory Transfers

- **Columnar Tables Only:** Market bar data transferred between threads or passed to the charting adapter must use [`ColumnarBarTable`](../packages/data/src/columnar/ColumnarBarTable.ts).
- **No Object Array Cloning:** Never serialize or pass arrays of individual bar objects (`{ time, open, high, low, close, volume }[]`) over worker messages. Always transfer the underlying `ArrayBuffer` via Web Worker Transferables.

### 3. Pre-Commit Verification

Before submitting changes, ensure all verification gates pass cleanly:

```bash
npm run typecheck && npm test
```

Any modification touching package dependencies, imports, or worker messaging contracts must explicitly verify [`packages/shell/test/licensing-boundary.test.ts`](../packages/shell/test/licensing-boundary.test.ts).
