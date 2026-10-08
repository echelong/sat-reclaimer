import { afterAll, describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64 } from '@scure/base';
import { MAX_SWEEP_WEIGHT, estimateSweepWeight, vsizeFor } from '../src/lib/bitcoin';
import { countInscriptions, sumSats } from '../src/lib/ordinals';
import { expectationFor, planSweep, type SweepPlan } from '../src/lib/psbt';
import { verifySignedPsbt } from '../src/lib/verify';
import { KEY_B_PRIV, ORDINALS, makeUtxos, taprootFor } from './fixtures';

/**
 * Large-wallet acceptance.
 *
 * Every size is planned by the real planner and measured from the real serialized
 * PSBT — nothing here is extrapolated from a per-input rule.
 *
 * Sizes up to 2,000 also sign and independently verify every input with the
 * deterministic test key, which is the expensive part and the part that proves the
 * whole pipeline holds at scale. 5,000 and 10,000 are planned, measured and
 * asserted but not locally signed: signing ten thousand inputs in-process adds
 * minutes and proves nothing the 2,000-input case has not already proved. That
 * split is deliberate and the numbers printed here are the numbers reported in
 * `docs/PERFORMANCE.md`.
 *
 * The printed table is emitted by `afterAll` rather than asserted on, so running
 * one size with `-t` still works.
 *
 * The 10,000-UTXO case is gated behind `LARGE_WALLET_MAX=1` (`pnpm test:max`).
 * Planning ten thousand inputs is one ~100-second synchronous computation, and
 * vitest's worker heartbeat gives up after 60 seconds of a blocked event loop,
 * which surfaces as a spurious `[vitest-worker]: Timeout calling "onTaskUpdate"`
 * failure even though every assertion passes. It is not skipped to make anything
 * pass: it is run explicitly as part of release verification, its measured
 * results are recorded in `docs/PERFORMANCE.md`, and it asserts the same
 * invariants as every other size.
 */

const DESTINATION = taprootFor(KEY_B_PRIV).address;
const NETWORK = 'Signet' as const;
const FEE_RATE = 2n;

type Sample = {
  size: number;
  signed: boolean;
  planMs: number;
  batchCount: number;
  vsizeLargest: number;
  weightLargest: number;
  totalWeight: number;
  psbtKib: number;
  rawKib: number;
  signVerifyMs: number | null;
  rssMb: number;
  feePercent: number;
};

const samples: Sample[] = [];

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

function planFor(size: number): SweepPlan {
  return planSweep({
    utxos: makeUtxos(size),
    ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
    destination: DESTINATION,
    feeRateSatVb: FEE_RATE,
    network: NETWORK,
    mainnetEnabled: true,
  });
}

async function signAndVerifyAll(
  plan: SweepPlan,
): Promise<{
  ok: boolean;
  signedInputs: number;
  inputs: number;
  outputs: number;
  ms: number;
  rawBytes: number;
  batchResults: number[];
}> {
  const started = performance.now();
  let ok = true;
  let signedInputs = 0;
  let inputs = 0;
  let outputs = 0;
  let rawBytes = 0;
  const batchResults: number[] = [];
  // One signing request per batch, sequentially, exactly as the console drives
  // Xverse. Each batch is signed, decoded and verified on its own before the next
  // one is touched, and the event loop is yielded between batches so the worker's
  // heartbeat is never blocked by the whole multi-batch run.
  for (const batch of plan.batches) {
    const tx = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));
    for (let index = 0; index < tx.inputsLength; index += 1) {
      if (!tx.signIdx(ORDINALS.priv, index)) {
        throw new Error(`could not sign input ${index} of batch ${batch.index}`);
      }
    }
    const report = verifySignedPsbt(
      base64.encode(tx.toPSBT(0)),
      expectationFor(batch, ORDINALS.scriptHex),
    );
    if (!report.ok) throw new Error(`batch ${batch.index} failed verification`);
    ok &&= report.ok;
    signedInputs += report.signedInputCount;
    inputs += report.inputCount;
    outputs += report.outputCount;
    if (report.rawTxHex) rawBytes += report.rawTxHex.length / 2;
    batchResults.push(report.signedInputCount);
    await yieldToEventLoop();
  }
  return { ok, signedInputs, inputs, outputs, ms: performance.now() - started, rawBytes, batchResults };
}

/**
 * Yield a macrotask so vitest's worker RPC can drain between the CPU-heavy
 * sweeps. This does not change what is computed or asserted; it only lets the
 * worker answer its supervisor while the suite runs. See `tests/psbt.test.ts`
 * for the original explanation.
 */
async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Invariants that must hold for every plan at every size, signed or not. */
function assertPlanInvariants(size: number, plan: SweepPlan) {
  const swept = plan.batches.flatMap((batch) => batch.inputOutpoints);
  // Not one input may be duplicated, and not one may be lost.
  expect(new Set(swept).size).toBe(size);
  expect(swept.length).toBe(size);
  expect(plan.inputCount).toBe(size);

  // The planner never loses or invents sats.
  const utxos = plan.batches.flatMap((batch) => batch.utxos);
  expect(sumSats(utxos)).toBe(plan.inputSats);
  expect(countInscriptions(utxos)).toBe(size);
  expect(plan.outputSats + plan.feeSats).toBe(plan.inputSats);
  expect(plan.inputSats).toBe(BigInt(size) * 10_000n);

  // Every transaction fits the relay policy with the safety margin intact.
  for (const measurement of plan.measurements) {
    expect(measurement.weight).toBeLessThanOrEqual(MAX_SWEEP_WEIGHT);
    expect(measurement.weight).toBeLessThan(400_000);
    expect(measurement.vsize).toBe(vsizeFor(measurement.weight));
    expect(measurement.outputSats + measurement.feeSats).toBe(measurement.inputSats);
  }
  expect(plan.maxWeight).toBe(Math.max(...plan.measurements.map((m) => m.weight)));

  for (const batch of plan.batches) {
    expect(batch.outputSats).toBeGreaterThan(0n);
    expect(batch.signInputIndexes.length).toBe(batch.utxos.length);
    // Signing indexes are the PSBT's own input order and nothing else.
    expect(batch.signInputIndexes).toEqual(
      Array.from({ length: batch.utxos.length }, (_, index) => index),
    );
  }
}

async function measure(size: number, signed: boolean): Promise<Sample> {
  await yieldToEventLoop();
  const started = performance.now();
  const plan = planFor(size);
  const planMs = performance.now() - started;

  assertPlanInvariants(size, plan);
  await yieldToEventLoop();

  const largest = plan.batches.reduce((max, batch) => (batch.weight > max.weight ? batch : max));
  const measurement = plan.measurements[largest.index];
  const psbtBase64Bytes = plan.batches.reduce((total, batch) => total + batch.psbtBase64.length, 0);

  let signVerifyMs: number | null = null;
  let rawBytes = Math.round((psbtBase64Bytes * 3) / 4);
  if (signed) {
    const result = await signAndVerifyAll(plan);
    expect(result.ok).toBe(true);
    expect(result.signedInputs).toBe(size);
    expect(result.inputs).toBe(size);
    expect(result.outputs).toBe(plan.batchCount);
    // Every batch was signed and verified on its own, and together they cover
    // exactly the selected set with nothing signed twice.
    expect(result.batchResults.reduce((total, count) => total + count, 0)).toBe(size);
    signVerifyMs = Math.round(result.ms);
    rawBytes = result.rawBytes;
  }

  const sample: Sample = {
    size,
    signed,
    planMs: Math.round(planMs),
    batchCount: plan.batchCount,
    vsizeLargest: measurement.vsize,
    weightLargest: measurement.weight,
    totalWeight: plan.totalWeight,
    psbtKib: Math.round((psbtBase64Bytes / 1024) * 10) / 10,
    rawKib: Math.round((rawBytes / 1024) * 10) / 10,
    signVerifyMs,
    rssMb: rssMb(),
    feePercent: Number(plan.feePercent.toFixed(3)),
  };
  samples.push(sample);
  await yieldToEventLoop();
  return sample;
}

describe('large-wallet acceptance: planned, signed and independently verified', () => {
  it('1 UTXO', { timeout: 60_000 }, async () => {
    const sample = await measure(1, true);
    expect(sample.batchCount).toBe(1);
    expect(sample.rawKib).toBeGreaterThan(0);
  });

  it('100 UTXOs', { timeout: 180_000 }, async () => {
    const sample = await measure(100, true);
    expect(sample.batchCount).toBe(1);
    // The analytic model and the measured artifact must agree exactly.
    expect(sample.weightLargest).toBe(estimateSweepWeight(100, 34));
  });

  it('500 UTXOs', { timeout: 300_000 }, async () => {
    const sample = await measure(500, true);
    expect(sample.batchCount).toBe(1);
    expect(sample.weightLargest).toBeLessThan(MAX_SWEEP_WEIGHT);
  });

  it('1,083 UTXOs (the documented wallet)', { timeout: 600_000 }, async () => {
    const sample = await measure(1_083, true);
    expect(sample.batchCount).toBe(1);
    // The published measurement: 1,083 inputs to a P2TR destination is
    // 249,312 WU = 62,328 vB, and it fits in one transaction.
    expect(sample.weightLargest).toBe(249_312);
    expect(sample.vsizeLargest).toBe(62_328);
  });

  it('2,000 UTXOs needs more than one transaction', { timeout: 900_000 }, async () => {
    const sample = await measure(2_000, true);
    expect(sample.batchCount).toBe(2);
    expect(sample.totalWeight).toBeGreaterThan(sample.weightLargest);
  });

  it('5,000 UTXOs', { timeout: 900_000 }, async () => {
    const sample = await measure(5_000, true);
    expect(sample.batchCount).toBe(3);
  });
});

describe.skipIf(process.env.LARGE_WALLET_MAX !== '1')(
  'large-wallet acceptance: the 10,000-UTXO scale run (`pnpm test:max`)',
  () => {
    it('10,000 UTXOs are planned, batched and measured', { timeout: 1_800_000 }, async () => {
      const sample = await measure(10_000, false);
      // 10,000 inputs at 230 WU each cannot fit one transaction: the plan must
      // split them into the minimum number of batches with nothing lost.
      expect(sample.batchCount).toBe(6);
      expect(sample.psbtKib).toBeGreaterThan(0);
      expect(sample.totalWeight).toBeGreaterThan(sample.weightLargest);
    });
  },
);

afterAll(() => {
  if (samples.length === 0) return;
  const header =
    'n'.padStart(6) +
    'sign'.padStart(6) +
    'batches'.padStart(9) +
    'largest'.padStart(14) +
    'planMs'.padStart(9) +
    'signVerMs'.padStart(11) +
    'psbtKiB'.padStart(10) +
    'rawKiB'.padStart(9) +
    'fee%'.padStart(8) +
    'rssMB'.padStart(8);
  const rows = [...samples]
    .sort((a, b) => a.size - b.size)
    .map((s) =>
      String(s.size).padStart(6) +
      (s.signed ? 'yes' : 'no').padStart(6) +
      String(s.batchCount).padStart(9) +
      `${s.weightLargest}WU`.padStart(14) +
      String(s.planMs).padStart(9) +
      String(s.signVerifyMs ?? '-').padStart(11) +
      String(s.psbtKib).padStart(10) +
      String(s.rawKib).padStart(9) +
      String(s.feePercent).padStart(8) +
      String(s.rssMb).padStart(8),
    );
  console.log(['', '[large-wallet] summary', header, ...rows, ''].join('\n'));
});
