# Sat Reclaimer architecture

## Product thesis

Bitcoin wallets protect inscription-bearing UTXOs from ordinary coin selection.
Sat Reclaimer gives the owner an explicit opt-out: treat selected
inscription-bearing Taproot outputs as BTC inputs and sweep their monetary value
to a Bitcoin destination.

The inscription semantics are not removed. The product intentionally stops
preserving them. An inscription-bearing output is still a Bitcoin UTXO, and the
user explicitly accepts that this may move or affect whatever it carries.

## Trust model

The web app is not a wallet custodian.

1. Xverse exposes the user's Ordinals P2TR address and its public key.
2. The app verifies the address is the BIP86 output of that key, or stops.
3. `ord_getInscriptions` enumerates inscriptions; the response is treated as
   untrusted input.
4. Rows are reduced to a unique `txid:vout` set.
5. The app builds a PSBT using those P2TR outputs as inputs.
6. Xverse signs only the input indexes assigned to the Ordinals address, with
   `broadcast: false`.
7. The returned PSBT is decoded and independently verified.
8. Broadcast is a separate, gated action.

No seed phrase or private key enters the application.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/lib/errors.ts` | `ReclaimerError` with machine-readable codes; callers never parse messages |
| `src/lib/types.ts` | Domain types, decoded transaction types, verification report types |
| `src/lib/bitcoin.ts` | Networks, mainnet/broadcast gates, address validation, BIP86 Taproot derivation and the address/key proof, consensus limits, weight arithmetic |
| `src/lib/sighash.ts` | Independent BIP341 key-path sighash (DEFAULT/ALL), with the midstate computed once per transaction |
| `src/lib/ordinals.ts` | Outpoint parsing, untrusted-row validation, deduplication and quarantine, weight-aware batching, pagination rails, asset classification |
| `src/lib/psbt.ts` | PSBT construction, exact accounting, sign-input index derivation, decoded re-check of its own output |
| `src/lib/verify.ts` | Decoder independent of the builder, plus signed-PSBT verification and Schnorr checks |
| `src/lib/xverse.ts` | Sats Connect client: typed requests, timeouts, error mapping, network reconciliation, gated broadcast |
| `src/components/Reclaimer.tsx` | UI: connect, scan, acknowledge, select, build, sign, verify, broadcast |

Import direction is one-way: `errors → types → bitcoin → sighash → ordinals →
psbt/verify → xverse → ui`. Only `xverse.ts` imports `sats-connect`, so the
Bitcoin logic is testable without a browser.

## Design rules

- **The transaction is the source of truth.** The builder decodes its own output
  and reports numbers derived from the serialized PSBT. The verifier never reads
  application state.
- **Two implementations must agree.** `src/lib/sighash.ts` recomputes BIP341
  segwit-v1 digests independently, and `tests/sighash.test.ts` asserts it matches
  `@scure/btc-signer`'s `preimageWitnessV1` bit-for-bit over real built
  transactions for 1–100 inputs and both supported sighash types.
- **Fail closed.** Every unexpected condition throws a coded error and stops the
  flow rather than producing a transaction.
- **Weight-aware batching.** Batches are bounded by input count *and* a 400,000 WU
  budget: `weight = 4*(4+4+varint(in)+varint(out)) + 2 + 230*inputs + 4*(8+1+34)`
  for a one-output P2TR sweep. 230 WU is the measured P2TR key-path input weight.

## Published API surface (verified against installed packages)

- `sats-connect@4.2.1`: `request(method, params)`; `wallet_connect`,
  `ord_getInscriptions`, `signPsbt`, `wallet_disconnect`.
- `@scure/btc-signer@2.4.1`: `p2tr`, `selectUTXO`, `Transaction.fromPSBT`,
  `preimageWitnessV1`, `Address`, `OutScript`, `RawTx`, `SigHash`.
- `getInputType` classifies Taproot from the prevout script, and
  `finalizeIdx` only finalizes a key-path input when `tapKeySig` is present, so a
  partially signed PSBT cannot be finalized. Verification checks each input
  individually instead of relying on finalization.

## Milestones

### M0: transaction-planning spike

Status: complete and audited. The prototype's `any`-typed wallet calls, missing
`tapInternalKey` on PSBT inputs, unverified wallet responses and unvalidated
destination address were all replaced.

### M1: signer compatibility proof

Status: implementation complete, local proof complete, live wallet approval
outstanding.

- Build, sign (locally) and verify 1/10/50/100/200/500-input batches with exact
  accounting; a 901-UTXO wallet splits into 5 batches.
- Xverse is asked to sign exactly the Ordinals input indexes with
  `broadcast: false`.
- Local verification of the signed PSBT: outpoints, prevout values, input
  scripts, single output, destination script, amount, fee, conservation, txid
  stability, per-input signature presence and Schnorr validity, sighash-type
  safety, and finalizability.

Acceptance still requires a real Xverse wallet to sign real inscription inputs on
Signet, with the signed bytes verified by this app.

### M2: transaction safety layer

Status: largely delivered early. The decoder is independent of the builder, the
preview is produced from the serialized PSBT, and the signed PSBT is decoded
again against the same invariants.

### M3: asset-awareness

Status: partial. UTXO-level classification exists (inscription-bearing,
multi-inscription, JSON-like content types, curated collections, missing content
types) and every assessment reports `detectionComplete: false`. Runes, BRC-20
balances and rare sats are not detectable through this API and are reported as
such instead of being guessed.

### M4: large-wallet sweeper

Status: partial. Batching is weight- and count-bounded and deterministic. Not yet
done: probing real wallet/provider payload limits, sequential signed-batch
tracking, resume after cancellation, fee-rate refresh between batches.

### M5: mainnet beta

Blocked. Requires a live Signet signing run, a confirmed Signet transaction,
independent security review and a manual decision to unlock the flag.

## Non-goals

- custody
- key generation
- seed import
- pretending inscriptions are deleted
- preserving Ordinal assignment when a user opts into destructive reclaim
- automatic BTC-to-SOL swapping in the core wallet layer

A swap integration can later use any valid BTC deposit address as the sweep
destination.
