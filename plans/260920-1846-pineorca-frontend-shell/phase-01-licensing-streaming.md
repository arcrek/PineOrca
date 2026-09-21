---
phase: 1
title: "Licensing Boundary Seam, Protocol Extensions & High-Performance Streaming Pipeline"
status: complete
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Licensing Boundary Seam, Protocol Extensions & High-Performance Streaming Pipeline

#### 1. Objectives & Licensing Seam Enforcement
- Guarantee strict separation of Apache-2.0 and AGPL-3.0 domains by scrubbing copyleft dependencies from host packages.
- Wire `STREAM_TICK` command execution into `packages/engine-pinets/src/worker/worker.ts` leveraging `LiveStreamingLoop` and `StateSnapshot` for 0-drift provisional bar execution.
- Validate zero-copy `ArrayBuffer` transfer lists between WorkerBridge and Engine Worker.

#### 2. File Ownership & Exact Symbols
- **`packages/ui/package.json`**:
  - Remove `"@pineorca/engine-pinets": "*"` from `dependencies`.
  - Maintain `"license": "Apache-2.0"`.
- **`packages/chart/package.json`**:
  - Remove `"@pineorca/engine-pinets": "*"` from `dependencies`.
  - Maintain `"license": "Apache-2.0"`.
- **`packages/engine-pinets/src/worker/worker.ts`**:
  - Symbol: `handleWorkerCommand` (`case 'STREAM_TICK'`).
  - Symbol: `activeStreamingLoops: Map<string, LiveStreamingLoop>`.
  - Symbol: `handleStreamTickCommand(payload: StreamTickPayload, postMessageFn: WorkerResponseSender)`.
- **`packages/worker-bridge/src/WorkerBridge.ts`**:
  - Symbol: `WorkerBridge.streamTick(payload: StreamTickPayload): Promise<StreamTickResultPayload>`.
  - Symbol: `WorkerBridge.onTickResult(runId: string, cb: (res: StreamTickResultPayload) => void): () => void`.
- **`packages/worker-bridge/test/streaming-protocol.test.ts`**:
  - Headless test file verifying stream tick command dispatch and zero-copy transfer integrity.

#### 3. Step-by-Step Implementation Tasks
1. Edit `packages/ui/package.json` and remove the unused `@pineorca/engine-pinets` dependency line.
2. Edit `packages/chart/package.json` and remove the unused `@pineorca/engine-pinets` dependency line.
3. In `packages/engine-pinets/src/worker/worker.ts`:
   - Import `LiveStreamingLoop` from `../streaming/LiveStreamingLoop.js`.
   - Maintain module-level `activeStreamingLoops = new Map<string, LiveStreamingLoop>()`.
   - Add handler for `case 'STREAM_TICK'`:
     - If loop for `runId` does not exist, initialize `LiveStreamingLoop` using transpiled strategy and confirmed state snapshot from `activeRuns`.
     - Dispatch tick through `loop.pushTick({ price, volume, time })`.
     - Emit typed response `'STREAM_TICK_RESULT'` containing updated forming bar, provisional metrics, and open trades.
4. In `packages/worker-bridge/src/WorkerBridge.ts`:
   - Enhance `streamTick` method to accept typed `StreamTickPayload` and return `Promise<StreamTickResultPayload>`.
   - Add support for streaming response callbacks.
5. Create `packages/worker-bridge/test/streaming-protocol.test.ts` ensuring `STREAM_TICK` commands serialize, transmit, and resolve properly.

#### 4. Verification Commands
```bash
# Verify UI and Chart package dependencies contain zero engine-pinets references
grep -q '"@pineorca/engine-pinets"' packages/ui/package.json && echo "FAIL: engine-pinets in ui" || echo "PASS: ui clean"
grep -q '"@pineorca/engine-pinets"' packages/chart/package.json && echo "FAIL: engine-pinets in chart" || echo "PASS: chart clean"

# Run worker bridge and streaming protocol tests
npx vitest run packages/worker-bridge/test/streaming-protocol.test.ts
```

---
