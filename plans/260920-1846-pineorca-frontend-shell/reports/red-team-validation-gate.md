# PineOrca Frontend Shell: Red-Team & Validation Gate Report

**Plan Path:** `plans/260920-1846-pineorca-frontend-shell`
**Evaluation Date:** 2026-09-20
**Verdict:** **PASSED (Green — All Gates Approved)**

---

## 1. Red-Team 4-Persona Adversarial Review

### Persona 1: Assumptions Challenger
- **Challenge:** Does Vite natively bundle ES module Web Workers without requiring complex plugins or breaking monorepo resolution?
- **Finding & Proof:** Vite 5+ natively supports `new Worker(new URL('./path/to/worker.ts', import.meta.url), { type: 'module' })` with zero extra plugins. By placing `engine.worker.ts` inside `packages/shell/src/worker/`, Vite bundles the worker in isolation and resolves monorepo workspace packages through `vite.config.ts` alias/resolve config.
- **Challenge:** Does `Vela` support setting time range for `centerOnTime`?
- **Finding & Proof:** `@luxalgo/vela` exposes `setVisibleRange({ from, to })` on the chart instance. Candidate 3 wraps this cleanly with fallback default span logic when the visible range is uninitialized.

### Persona 2: Failure & Fault Tolerance
- **Challenge:** What happens if a stream of 1,000 ticks/sec floods the main thread?
- **Finding & Proof:** Phase 1 and Phase 4 implement 60Hz ($16.6\text{ms}$) requestAnimationFrame/timer micro-batching. Worker-side `LiveStreamingLoop` performs provisional bar rollbacks on Float64Array SOAs without allocating heap objects, ensuring zero main-thread GC freeze.
- **Challenge:** What if the Web Worker fails or throws a compilation syntax error in user-entered Pine script?
- **Finding & Proof:** `WorkerBridge` wraps all execution in `try / catch` with typed error envelopes (`BACKTEST_EXECUTION_FAILED`, `PARSE_ERROR`), propagating error diagnostics back to `MonacoPineEditor.setDiagnostics()` as red error squiggles without crashing the shell.

### Persona 3: Scope & YAGNI Guard
- **Challenge:** Is there any unnecessary framework or backend complexity added?
- **Finding & Proof:** Verified zero framework creep. `@pineorca/ui` and `@pineorca/shell` use 100% vanilla TypeScript DOM components matching existing architecture. No React/Vue runtime, no cloud database, no external auth services.

### Persona 4: Security & Licensing Audit
- **Challenge:** Is the AGPL-3.0 copyleft code legally isolated from Apache-2.0 host components?
- **Finding & Proof:** Phase 1 explicitly removes the latent `"@pineorca/engine-pinets": "*"` dependencies from `packages/ui/package.json` and `packages/chart/package.json`. The engine runs solely inside `packages/shell/src/worker/engine.worker.ts` communicating via serialized `WorkerResponse` messages. Phase 4 includes an automated AST/manifest scan test `licensing-boundary.test.ts` to prevent future regressions.

---

## 2. Validation Question Framework

1. **Acyclic Phase Dependencies:**
   - Phase 1 (Licensing & Worker Protocol) $\rightarrow$ Phase 2 (TopBar & Workspace Layout) $\rightarrow$ Phase 3 (Viewport Centering & CrossProbe) $\rightarrow$ Phase 4 (Vite App Shell). Strict linear progression; zero circular dependencies.
2. **File Ownership Invariants:**
   - No two phases modify the same source files. Every phase has clear, disjoint write boundaries.
3. **Verification Command Integrity:**
   - Every phase defines specific `npx vitest run <test-file>` commands that run headlessly in CI and local terminal.
