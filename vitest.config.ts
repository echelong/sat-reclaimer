import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The whole-wallet sweep tests build, serialize, finalize and measure very
    // large transactions synchronously (a 1,083-input sweep is ~250,000 WU).
    // Running the test files in parallel saturates every core and competes with
    // the worker RPC channel. Files therefore run one at a time, and the heavy
    // sweep tests yield to the event loop between large builds (see
    // `yieldToEventLoop` in tests/psbt.test.ts). Without both, ~52 s of
    // CPU-bound work can delay the `onTaskUpdate` response past birpc's 60 s
    // timeout, which surfaces as a flaky
    // "[vitest-worker]: Timeout calling onTaskUpdate" even though every
    // assertion passes. Tests still run in full; nothing is skipped or weakened.
    fileParallelism: false,
  },
});
