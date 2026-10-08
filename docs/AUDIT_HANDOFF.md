# Independent audit handoff

**No independent external security review of SAT//RECLAIMER has been performed.**

This document exists to make one possible. It is a briefing for a reviewer, not a
review, not a report, and not evidence of anything. Nothing in it should be read as
a finding, a clearance or a certification. The author of this repository wrote the
code and wrote [`docs/SECURITY_REVIEW.md`](SECURITY_REVIEW.md), and an internal
review by the author is not a substitute for an independent one.

Accordingly, **release gate A11/E7 stays NOT VERIFIED**, and unrestricted public
Mainnet launch stays blocked, until a genuinely independent reviewer completes an
engagement. See [`docs/RELEASE_GATES.md`](RELEASE_GATES.md).

If you take the engagement, the most useful outcome is a written list of things
that are wrong, with the conditions required to trigger each one.

---

## What the software does

It spends Bitcoin UTXOs that carry Ordinals inscriptions, as ordinary Bitcoin
inputs, and sweeps their monetary value to one destination address the user
chooses. It is a browser application with no server component, no accounts and no
custody. Keys stay in the user's wallet (Xverse, via Sats Connect); this code never
sees one.

The lifecycle is **CONNECT → SCAN → SELECT → BUILD → REVIEW → SIGN → VERIFY →
BROADCAST → CONFIRM**. The trust model is stated in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) under "Trust model" and "Design rules";
the two rules that matter most for review are that the transaction is the source of
truth (the builder decodes its own serialized output) and that the verifier never
reads application state.

## Reproducing the environment

From [`package.json`](../package.json): `engines.node` is `>=22`, and the pinned
package manager is `pnpm@10.17.1`.

```bash
git clone https://github.com/echelong/sat-reclaimer
cd sat-reclaimer
corepack enable && pnpm install --frozen-lockfile
pnpm verify      # lint, typecheck, test, build — all four must exit 0
pnpm test:max    # adds the 10,000-input plan (~100 s of CPU-bound work)
```

No network access is required for the test suite, and no Mainnet transaction is
ever submitted by it: `tests/broadcast.test.ts` uses a fake transport, and wallet
tests use a mocked provider. Two dependencies inherited from `sats-connect`
(`axios`, `valibot`) are forced forward with `pnpm.overrides`; the reasoning and
the one waived dev-only advisory are in [`SECURITY.md`](../SECURITY.md#dependencies).

---

## Trust boundaries to examine

### 1. PSBT construction and verification

**Start at:** `src/lib/psbt.ts` (`buildSweepBatch`, `signPsbtRequestFor`,
`expectationFor`, `measureSweep`, `measureFinalizedWeight`, `assertSweepEconomic`,
`planSweep`), then `src/lib/verify.ts` (`parsePsbt`, `decodeTransaction`,
`decodePsbt`, `verifySignedPsbt`).

**What must hold:** the unsigned PSBT handed to the wallet is built from values the
app re-derives, and after signing the *serialized* PSBT is decoded independently
and checked against the plan. `verifySignedPsbt` must not share mutable state with
the builder, and every number shown to the user must come from the decoded
artifact rather than from the object that produced it. Ask specifically: can a
PSBT be mutated between build and sign, or between sign and verify, and still pass?
Is the expectation object (`expectationFor`) derived from the same plan the user
reviewed?

### 2. BIP341 signing assumptions

**Start at:** `src/lib/sighash.ts` (`taggedHash`, `computeSighashMidstate`,
`taprootKeyPathSighash`).

**What must hold:** the independent sighash implementation must agree with
`@scure/btc-signer`'s `preimageWitnessV1` bit-for-bit for every supported sighash
type and input count — `tests/sighash.test.ts` asserts this, and the assertion is
the thing to try to defeat. The code assumes **key-path spends only**
(`tapInternalKey` is set, every witness is a single 64-byte element) and
`SIGHASH_DEFAULT`/`SIGHASH_ALL` only. Confirm that a non-default sighash type, a
script-path input, or an input whose `tapInternalKey` disagrees with the prevout
cannot be smuggled through verification. Also check the midstate is computed once
per transaction and cannot be reused across two different transactions.

### 3. UTXO and previous-output validation

**Start at:** `src/lib/ordinals.ts` (`validateInscriptionRow`, `scanInscriptionUtxos`,
`dedupeInscriptionUtxos`, `uniqueByOutpoint`, `splitIntoBatches`, `assessUtxo`,
`fetchAllInscriptions`, `assertScanComplete`), and
`src/lib/bitcoin.ts` (`normalizeOrdinalPublicKey`, `deriveOrdinalTaproot`).

**What must hold:** indexer rows are untrusted input. A malformed outpoint, an
invalid postage value, a foreign address or two rows disagreeing about one output's
value must be quarantined rather than swept; inputs must be deduplicated by
`txid:vout` at every stage; and the BIP86 address-to-public-key proof must fail
closed. Prevout values and script types come from the wallet's PSBT data, so ask
what happens when a reported prevout value is wrong — and check the claim in
`docs/SECURITY_REVIEW.md` that this produces a rejection, never a redirection.

### 4. Fee accounting

**Start at:** `src/lib/bitcoin.ts` (`MAX_STANDARD_TX_WEIGHT`, `MAX_SWEEP_WEIGHT`,
`SWEEP_WEIGHT_SAFETY_MARGIN`, `feeForWeight`, `largestInputCountForWeight`,
`estimateSweepWeight`, `assertFeeRateAllowed`, `DUST_RELAY_FEE_SAT_PER_KVB`,
`dustThresholdSats`) and `src/lib/psbt.ts` (`measureFinalizedWeight`,
`assertSweepEconomic`).

**What must hold:** the fee is `vsize × fee rate` over the **measured** finalized
weight, never a per-input rule; `Σinputs = Σoutputs + fee` must hold on the
serialized artifact; the sweep must stay under `MAX_SWEEP_WEIGHT` (396,000 WU, a
4,000 WU margin below the 400,000 WU standard limit); and a remainder that would be
unspendable must abort rather than be burned as fee. The builder asserts
`feeSats >= feeForWeight(measuredWeight, rate)`. Note the honest gap recorded in
F3: the library collapses a sub-dust remainder before the dust guard can observe
it, so that guard is currently unreachable and is verified by inspection only.
Confirm whether that collapse can ever silently burn value.

### 5. Destination integrity

**Start at:** `src/lib/bitcoin.ts` (`validateDestinationAddress`) and the
single-output construction in `src/lib/psbt.ts`.

**What must hold:** exactly one output, its script matching the address the user
entered, on the same network as the transaction, with no silent conversion between
networks, and the amount matching `inputs − fee` exactly. The strongest thing to
test is an address that is valid but not the one displayed, and any path where the
output script could be replaced after the user reviewed it.

### 6. Mainnet broadcast authorization

**Start at:** `src/lib/broadcast.ts` (`isBroadcastAuthorised`,
`assertBroadcastAuthorised`, `endpointsForNetwork`, `MAINNET_BROADCAST_ENDPOINTS`,
`txidFromRawTransaction`, `assertFinalizedTransaction`, `broadcastRawTransaction`,
`createBroadcastState`, `checkTxidStatus`, `classifyRejection`) and
`src/components/Reclaimer.tsx`.

**What must hold:** this is the highest-value target. Signing and broadcasting are
separate, `signPsbt` always sends `broadcast: false`, and broadcasting requires an
operator flag **plus** a per-`txid` authorization **plus** a locally recomputed
txid that must match the authorized one. Endpoints are scoped by the transaction's
own network, so a Mainnet transaction can never reach a testnet host. The submitted
bytes must be finalized (non-empty witness on every input). A mismatched returned
txid is a failure, never a success. An ambiguous response must be resolved by a
txid lookup, never a resubmission, and no replacement may ever be signed.

**Treat the `NEXT_PUBLIC_*` flags as product policy, not as a boundary.** They are
public browser configuration and can be edited by anyone running the code. The real
boundary is the wallet approval plus the independent verification that follows it.
Please look for a path that reaches a broadcast without every one of those gates,
and for any way the reviewed bytes and the submitted bytes can differ.

### 7. Imported transaction risks

**Start at:** `src/lib/imported-transaction.ts` (`normalizeRawTransactionHex`,
`inspectImportedTransaction`, `ImportedTransactionReport`) and
`src/components/console/ImportTransaction.tsx`.

**What must hold:** an imported raw transaction never inherits a prior approval (a
fresh per-`txid` acknowledgement and the `SPEND AS BTC` phrase are required again),
never broadcasts automatically, and shares the broadcast ledger with built sweeps
so nothing can be submitted twice. Where the original approval evidence is absent it
must report what cannot be verified rather than assume it: `feeSats` and `inputSats`
are returned `null` with an explicit `unverifiable` list. **A raw transaction
carries no network identity** — the scripts are byte-identical across chains — so
the network cannot be verified from the bytes, only rejected by a node on the wrong
chain. F10 records that an attempted `detectNetwork` check was deleted rather than
shipped.

### 8. Third-party provider dependencies

**Start at:** `src/lib/xverse.ts` (`connectXverse`, `scanOrdinals`, `signPsbt`,
`disconnectXverse`, `networkFromSatsConnect`, `isWalletSizeLimitError`).

Three untrusted parties sit in the path:

- **Xverse via `sats-connect@4.2.1`** — returns addresses, the public key, the
  inscription list and the signed PSBT. The reported network is compared with the
  requested one and a mismatch stops the flow, but the wallet is ultimately
  trusted to sign what was asked and to return a PSBT the app can decode.
- **The Ordinals indexer behind the wallet's inscription API** — supplies every
  value and outpoint the sweep is built from.
- **Public broadcast and status nodes: `mempool.space`, `blockstream.info`,
  `mempool.emzy.de`** — receive the raw transaction, or a txid lookup. They can be
  down, rate-limit, censor, or answer inconsistently. `checkTxidStatus` only
  accepts a body carrying a **boolean** `confirmed`; anything else is inconclusive.

Ask what a malicious wallet can accomplish short of refusing to sign, and whether
any indexer response can cause a **loss of funds** rather than a rejection.

---

## What we would most like you to attack

1. **Can a user be made to sign or broadcast bytes other than the ones they
   reviewed?** This is the failure that matters most. Any gap between the preview,
   the PSBT sent for signing, and the bytes submitted is a critical finding.
2. **Can an indexer response cause loss rather than rejection?** The design claims
   BIP341's commitment to prevout amounts makes spoofing produce an invalid
   signature. Try to falsify that claim.
3. **Can an ambiguous or repeated network response produce a double spend or an
   unintended replacement?** Look for any path that resubmits, retries, or signs a
   second transaction over the same inputs.
4. **Can verification be satisfied by something that is not the reviewed
   transaction?** Especially around `expectationFor`, sighash-type handling, and
   the per-input signature checks.
5. **Can the destination be changed after review?** Including by an address that
   is valid but not the one the user read.
6. **Can a large wallet be split into batches that lose, duplicate or reorder
   inputs?** The invariants are asserted in `tests/large-wallet.test.ts`; attack
   the assertions, not just the code.

## Deliberately out of scope

- **Xverse itself, and Sats Connect as a product.** Their internal implementation
  is not ours to audit. The interface this app consumes is in scope.
- **The Ordinals indexer's accuracy, availability or policy.** Its responses are
  in scope as untrusted input.
- **The public broadcast and status nodes' availability and policy decisions.**
  How this app handles their answers is in scope.
- **The irreversible nature of spending an inscription output**, and the fact that
  an inscription, rune balance, BRC-20 state or rare sat may move with the sats.
  That is the documented, acknowledged purpose of the tool
  ([`docs/RISK.md`](RISK.md)), not a defect.
- **Compromise of the user's own machine, browser or wallet extension.**
- **Nothing here asserts that transactions are reversible, that asset detection is
  complete, or that every wallet is supported.** Those are known limitations, not
  findings.

---

## Previous internal findings

Internal review, by the author, with each fixed item regression-locked in
`tests/security-regressions.test.ts`. **This is not independent review and must not
be treated as a substitute for it.** Full detail in
[`docs/SECURITY_REVIEW.md`](SECURITY_REVIEW.md).

| Id | Severity | Impact in one line | State |
| --- | --- | --- | --- |
| F1 | High | A postage conflict excluded one indexer row, but a later row for the same output could resurrect it and re-admit a contradictory UTXO to the sweep. | Fixed |
| F2 | Medium | The outpoint-set comparison was one-directional, so a signed PSBT missing an input could still compare as "the same set". | Fixed |
| F3 | Medium | No explicit dust assertion on the destination output; the guard is now present but unreachable because the library collapses the remainder first. | Hardened |
| F4 | Medium | Nothing asserted that the fee covered the transaction's own measured size — an underpaid transaction verifies locally and then fails to relay. | Hardened |
| F5 | Low | The P2TR witness-program shape was only half-checked, so a malformed program could pass a superficial test. | Fixed |
| F6 | Low | An unparseable status body was reported as "in the mempool", fabricating an on-chain observation. | Fixed |
| F7 | Medium | Submission did not require a *finalized* transaction; an unsigned serialization hashes to the same txid and would be posted to nodes. | Fixed |
| F8 | Low (reliability) | The wallet payload-limit fallback could only fire once, so a second rejection dead-ended instead of splitting further. | Fixed |
| F9 | Low (transparency) | Indexer rows with no address were silently treated as verified, overstating what the scan had confirmed. | Fixed |
| F10 | Informational | A raw transaction carries no network identity; an attempted `detectNetwork` check was deleted rather than shipped as a check that can never fail. | Recorded |

## Other open items, stated so you do not have to discover them

- **Gate A11/E7 — no independent external review.** That is this document's reason
  for existing.
- **Gate B5/B6 — live wallet approval at scale is unexercised from this
  repository.** A real 1,079-input Mainnet sweep is confirmed on chain (block
  970454, [`docs/MAINNET_ACCEPTANCE.md`](MAINNET_ACCEPTANCE.md)), but the browser
  extension cannot be driven in this environment and Xverse's real PSBT payload
  limit is therefore unproven.
- **Gate C8/C9 — a signed transaction does not survive a page refresh on its own,**
  and no Signet end-to-end run is possible for want of an inscription-bearing
  Signet UTXO.
- **Gate E8 — there is no email or PGP contact**, only GitHub private vulnerability
  reporting. This is a pending owner decision, recorded rather than invented.

If you find something exploitable, please report it through GitHub's private
vulnerability reporting channel rather than a public issue — see
[`SECURITY.md`](../SECURITY.md).
