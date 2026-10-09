import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    // The whole-wallet sweep tests build, serialize, finalize and measure very
    // large transactions synchronously (a 1,083-input sweep is ~250,000 WU, and
    // the scale run plans 10,000 inputs). Files therefore run one at a time:
    // running them in parallel saturates every core and contends for the worker
    // RPC channel, which makes the heavy cases slower and their timings noisy.
    // The heavy tests also yield to the event loop between large builds (see
    // `yieldToEventLoop` in tests/psbt.test.ts) so the worker can answer its
    // supervisor and memory is reclaimed between sizes. Tests run in full;
    // nothing here skips an assertion or weakens one.
    fileParallelism: false,
  },
});
