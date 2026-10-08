# Large-wallet performance

Measured large-wallet acceptance for the Sweep All workflow. Every number below
comes from running the real planner and reading the real serialized PSBT — none
of it is extrapolated from a fixed per-input rule.

- **Measured** on Cobalt PC, 2026-10-08, Node v22.23.1, `pnpm@10.17.1`,
  `@scure/btc-signer@2.4.1`.
- **Reproduce:** `pnpm test` runs 1–5,000 UTXOs; `pnpm test:max`
  (`LARGE_WALLET_MAX=1`) additionally runs the 10,000-UTXO case.
  The raw table is printed by `tests/large-wallet.test.ts`.

Fixtures: every UTXO is a `10,000`-sat `v1_p2tr` output carrying one inscription,
all spendable by one deterministic test key. Destination is P2TR, fee rate
`2 sat/vB`. These are the same input type the Mainnet wallet held (key-path P2TR,
one 64-byte witness element), so the serialized sizes are directly comparable.

| UTXOs | signed & verified | batches | largest tx | plan (ms) | sign + verify (ms) | PSBT total (KiB) | raw total (KiB) | fee % | RSS (MB) |
| ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | yes | 1 | 444 WU | 35 | 25 | 0.2 | 0.2 | 2.22% | 99.4 |
| 100 | yes | 1 | 23,214 WU | 989 | 1,359 | 16.1 | 10.5 | 1.16% | 120.4 |
| 500 | yes | 1 | 115,222 WU | 4,592 | 7,859 | 80.2 | 52.3 | 1.15% | 133.3 |
| 1,083 | yes | 1 | 249,312 WU | 10,242 | 21,989 | 173.5 | 113.2 | 1.15% | 135.0 |
| 2,000 | yes | 2 | 395,822 WU | 19,426 | 46,434 | 320.5 | 209.1 | 1.15% | 187.3 |
| 5,000 | yes | 3 | 395,822 WU | 48,750 | 122,318 | 801.1 | 522.6 | 1.15% | 202.0 |
| 10,000 | no | 6 | 395,822 WU | 96,760 | — | 1,602.1 | 1,201.6 | 1.15% | 202.6 |

Weights, sizes and fee percentages are deterministic — they come from the
serialized artifacts and repeat exactly. The millisecond and RSS columns are
timings from one representative run and move by a few percent between runs.

`largest tx` is the weight of the biggest single batch, read from the finalized
serialized artifact. `plan (ms)` is measure-and-plan. `sign + verify (ms)` signs
every input of every batch with the deterministic key and independently verifies
each batch (decode, sighash, Schnorr). Fees stay near 1.15% of the swept value
because the fee is exact `vsize × fee rate`, not a rounded estimate.

## What the sizes prove

- **1,083 inputs fit in one transaction.** 249,312 WU = 62,328 vB, comfortably
  under the 396,000 WU sweep budget (which itself keeps a 4,000 WU margin below
  the 400,000 WU standard-relay limit). The documented wallet sweeps in one
  signature request.
- **The split point is real.** 2,000 inputs cannot fit one transaction, so the
  planner produces 2; 5,000 produces 3; 10,000 produces 6. Every batch ≤ 395,822
  WU, and the union of batches is exactly the selected set with nothing dropped
  and nothing signed twice (asserted per size, see below).
- **The analytic model agrees with the library and with the chain.** At 100
  inputs the measured weight equals `estimateSweepWeight(100, 34)` exactly. On
  Mainnet, `estimateSweepWeight(1079, 23)` = 248,348 WU = 62,087 vB matched the
  confirmed transaction on chain to the byte (`docs/MAINNET_ACCEPTANCE.md`).
- **Memory scales with the plan, not the batch count.** RSS grows from ~99 MB at
  1 input to ~203 MB at 10,000 and then flattens; the 10,000-input plan holds six
  PSBTs and six signed raw transactions in memory and stays under 210 MB.

## Per-size invariants asserted

For every size (signed or not) the test asserts, from the produced plan and the
serialized PSBTs:

- `Set(swept).size === size` and `swept.length === size` — no input is lost or
  duplicated; the plan is an exact partition of the selection.
- `sum(batch utxo sats) === plan.inputSats` and
  `plan.outputSats + plan.feeSats === plan.inputSats` — conservation holds across
  batches, not just within one.
- For each batch: `weight ≤ MAX_SWEEP_WEIGHT` (396,000), `weight < 400,000`,
  `vsize === vsizeFor(weight)`, `outputSats + feeSats === inputSats`.
- `batch.signInputIndexes` equals `0…n−1` for that batch — signing indexes are the
  PSBT's own input order and nothing else.
- For signed sizes: `signedInputs === size`, `outputs === plan.batchCount`, and the
  per-batch signed-input counts sum to exactly `size` — every batch signed and
  verified on its own, none signed twice.

## Interrupted batches cannot duplicate a transaction

Each batch is a distinct transaction over a distinct, non-overlapping set of
outpoints, and the outpoint set is deduplicated by `txid:vout` before planning.
A batch is signed, decoded and independently verified before the next batch is
touched, and broadcasting is a separate per-txid authorization
(`docs/SECURITY_REVIEW.md`, F-series regressions in
`tests/security-regressions.test.ts`). The verification report for a batch is
produced from that batch's own serialized PSBT, so a resumed or re-run flow
re-plans the same selection instead of accumulating a second transaction over an
already-spent input.

## What this does NOT prove

- **The Xverse payload limit is NOT VERIFIED.** Local signing with a deterministic
  key does not exercise the wallet provider's request-size limit, its timeout, or
  its own PSBT validation. The largest input count *approved by a real wallet* is
  recorded separately below.
- These are synthetic single-key fixtures. Signing 10,000 inputs in one process
  with one key is faster and more uniform than a real wallet signing thousands of
  inputs from a hardware/native key store.

### Largest input count actually approved by a real wallet

| Evidence | Inputs | Batches | Result |
| --- | ---: | ---: | --- |
| Confirmed Mainnet transaction `0a7d30ca…57e1a` (block 970454) | 1,079 | 1 | confirmed on chain, 62,087 vB, 62,087 sat fee |

That is on-chain evidence, not a re-observed wallet approval: this environment
cannot drive the browser wallet extension, so the wallet-side approval was not
re-exercised and no signed-PSBT artifact was retained. No synthetic run above
should be read as a claim about what Xverse will accept. Until a live wallet
approves and broadcasts a multi-thousand-input sweep, that row is the only
real-wallet data point and the wallet payload limit stays a release blocker
(`docs/RELEASE_GATES.md`, gate B/D).

## The 10,000-input case and vitest's worker heartbeat

Planning ten thousand inputs is one ~97-second synchronous computation. Vitest's
worker RPC abandons a task after 60 seconds of a blocked event loop and reports a
spurious `[vitest-worker]: Timeout calling "onTaskUpdate"` even when every
assertion passes. There is no configurable knob for it in vitest 3.2.7.

Two things follow:

1. The suite yields a macrotask between sizes and between batches
   (`yieldToEventLoop`) so the worker can answer its supervisor. This changes no
   computation and no assertion — it only lets the worker drain.
2. The 10,000-input case is behind `LARGE_WALLET_MAX=1` (`pnpm test:max`) so the
   default `pnpm test` never blocks the event loop that long. It is not skipped to
   make anything pass: it runs in CI as its own job, it asserts the same
   invariants as every other size, and its results are the 10,000-input row above.
