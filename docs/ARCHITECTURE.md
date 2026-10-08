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
7. The returned PSBT is decoded and independently verified, and only then
   finalized into raw transaction bytes.
8. Broadcast is a separate, explicitly authorized manual action: the raw bytes
   are re-hashed locally and submitted to independent public nodes, never to the
   wallet.

No seed phrase or private key enters the application.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/lib/errors.ts` | `ReclaimerError` with machine-readable codes; callers never parse messages |
| `src/lib/types.ts` | Domain types, decoded transaction types, verification report types |
| `src/lib/bitcoin.ts` | Networks, mainnet/broadcast gates, address validation, BIP86 Taproot derivation and the address/key proof, consensus limits, weight arithmetic |
| `src/lib/sighash.ts` | Independent BIP341 key-path sighash (DEFAULT/ALL), with the midstate computed once per transaction |
| `src/lib/ordinals.ts` | Outpoint parsing, untrusted-row validation, global deduplication and quarantine (including conflicting postage for one outpoint and a case-insensitive address compare), full-wallet pagination with a completeness flag, weight-aware batching, asset classification |
| `src/lib/psbt.ts` | PSBT construction, exact accounting, measured-size sweep planning with wallet-limit fallback, sign-input index derivation, decoded re-check of its own output, dust and minimum-fee assertions |
| `src/lib/verify.ts` | Decoder independent of the builder, plus signed-PSBT verification, Schnorr checks, and finalization only after verification passes |
| `src/lib/broadcast.ts` | Manual broadcast: operator authorization, local txid re-derivation, network-scoped endpoints, node-rejection classification, txid lookup instead of resubmission, duplicate-submission guard |
| `src/lib/imported-transaction.ts` | Inspecting a pasted/imported raw transaction: local decode, txid re-derivation, and an explicit list of what cannot be verified without the original approval evidence. Never inherits approval, never auto-broadcasts |
| `src/lib/xverse.ts` | Sats Connect client: typed requests, timeouts, error mapping, network reconciliation, wallet size-limit classification, signing only (`broadcast: false`) |
| `src/components/Reclaimer.tsx` | Console UI: connect, scan, acknowledge, select, build, sign, verify, review, authorize, broadcast |
| `src/components/console/ImportTransaction.tsx` | Import panel: load, inspect, acknowledge and (separately) broadcast an imported raw transaction |
| `src/components/legal/LegalPage.tsx` | Shared shell for the policy routes (`/privacy`, `/terms`, `/risk`, `/open-source`) |
| `app/layout.tsx` | Single root layout, shared metadata, and the only place global CSS is imported |
| `app/(routes)` | `/` is the public landing page; `/app` mounts `Reclaimer`. `app/icon.svg`, `app/sitemap.ts` and `app/robots.ts` are metadata routes |
| `src/components/landing/*` | Landing sections. `Nav`, `Hero`, `HowItWorks`, `Problem`, `Trust`, `Faq`, `Footer` are static; `HeroVisualization` and `Demo` are the only components that run a frame loop, and both own and release it |
| `src/components/ui/*` | Shared motion primitives (`Reveal`, `Counter`, `useReducedMotion`). Nothing here imports domain code |
| `scripts/start-local.mjs` | Local launcher. Chooses a network/broadcast mode, prints exactly what it is about to enable, binds to `127.0.0.1` only, and requires a typed phrase before Mainnet broadcasting can be enabled |
| `scripts/check-environment.mjs` | Read-only environment check (Node, pnpm, dependencies, platform) with per-platform install hints. Installs nothing, changes nothing, asks for no privileges |

Import direction is one-way: `errors → types → bitcoin → sighash → ordinals →
psbt/verify → broadcast → ui`, with `xverse` as a leaf for wallet access. Only
`xverse.ts` imports `sats-connect`, so the Bitcoin and broadcast logic is
testable without a browser.

Presentation code is a separate branch off that chain. `src/components/ui/*` and
the landing sections import nothing from `src/lib`, and `src/components/landing/Demo.tsx`
holds only hard-coded constants — it has no wallet handle and no network client, so
the simulated demo cannot sign or broadcast by construction rather than by
discipline. All wallet, PSBT, signing, verification and broadcast imports stay in
`src/components/Reclaimer.tsx` (plus `src/components/console/AppBar.tsx`, which
imports only `next/link`).

Styling is three plain-CSS layers imported once from `app/layout.tsx`:
`globals.css` (tokens, reset, shared primitives, reduced-motion), `landing.css`
(public page), `console.css` (`/app`). There is no CSS-in-JS, no utility
framework, and no animation dependency.

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
- **Measured sizing.** The sweep planner builds the candidate transaction,
  injects key-free placeholder signatures of exactly the size Xverse returns,
  finalizes it, and reads the real relay weight from the serialized artifact. It
  never sizes from a fixed per-input rule. `estimateSweepWeight` is retained only
  as a cross-check that the analytic model agrees with the library.
- **Size before building, not after.** `largestInputCountForWeight()` computes how
  many inputs of a given prevout type can fit the weight budget *before* a
  candidate is built. Without it the planner had to build the whole selection to
  measure it, and `buildSweepBatch` refuses anything over
  `MAX_STANDARD_TX_WEIGHT` — so for 2,000+ inputs the build threw before the
  planner could fall back to batching, and `WEIGHT_LIMIT_EXCEEDED` was
  unrecoverable. The fallback now runs because the count is known first.
- **Dust and fee floor.** `dustThresholdSats()` reimplements Core's
  `GetDustThreshold` per output type, and the builder asserts
  `feeSats >= feeForWeight(measuredWeight, rate)`. Honest limit: the library
  collapses a sub-dust remainder before the dust assertion can see it, so that
  guard is currently unreachable and is recorded as such rather than counted as
  exercised.

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

Status: implementation complete, local proof complete. A live Signet approval is
unavailable because there is no inscription-bearing Signet UTXO to spend, so the
operator explicitly authorized a controlled, single-input Mainnet proof in its
place (see M5). The local ladder and every verification check are unchanged.

- Build, sign (locally) and verify 1/10/50/100/200/500-input batches with exact
  accounting; a 901-UTXO wallet splits into 5 batches.
- Xverse is asked to sign exactly the Ordinals input indexes with
  `broadcast: false`.
- Local verification of the signed PSBT: outpoints, prevout values, input
  scripts, single output, destination script, amount, fee, conservation, txid
  stability, per-input signature presence and Schnorr validity, sighash-type
  safety, and finalizability.

Acceptance runs on whichever chain the operator has enabled. The whole wallet is
retrieved before anything is built, the sweep is sized from the measured
serialized transaction, and the signed bytes are still verified by this app
before anything else can happen. Signing never broadcasts.

### M2: transaction safety layer

Status: implemented. The decoder is independent of the builder, the preview is
produced from the serialized PSBT, and the signed PSBT is decoded again against
the same invariants. Finalization happens only after every check passes, and the
broadcast layer re-derives the txid from the raw bytes before any submission.

### M3: asset-awareness

Status: complete for its scope. UTXO-level classification exists
(inscription-bearing, multi-inscription, JSON-like content types, curated
collections, missing content types) and every assessment reports
`detectionComplete: false`. Runes, BRC-20 balances and rare sats are not
detectable through this API and are reported as such instead of being guessed.
The transaction export/import half is implemented: `imported-transaction.ts`
decodes an imported raw transaction locally, re-derives its txid, and reports
`feeSats`/`inputSats` as `null` with the explicit list of what cannot be verified
without the original approval evidence. An imported transaction never inherits
approval (fresh per-txid checkbox plus the `SPEND AS BTC` phrase) and never
auto-broadcasts.

### M4: large-wallet sweeper

Status: complete for the sizes that can be measured here. Batching is weight- and
count-bounded and deterministic, and 1/100/500/1,083/2,000/5,000/10,000 UTXOs are
planned, batched and measured from the serialized artifacts; every size up to
2,000 is also signed and independently verified. Results and the per-size
invariants are in [`docs/PERFORMANCE.md`](PERFORMANCE.md).

Still not proven, and recorded as **NOT VERIFIED** in
[`docs/RELEASE_GATES.md`](RELEASE_GATES.md): the provider's real PSBT payload
limit. Local signing with a deterministic key does not exercise Xverse's request
size limit. The largest input count approved by a real wallet is recorded
separately (1,079 inputs, evidenced by the confirmed Mainnet transaction).

### M5: Mainnet sweep workflow

Disabled by default. `NEXT_PUBLIC_ENABLE_MAINNET=true` is an explicit operator
decision that turns Mainnet on for the Sweep All workflow. It is a recorded
policy decision, not a hidden bypass.

While it is on:

- the whole wallet is paged in until the indexer total is exhausted or the
  provider returns an empty page; an incomplete scan blocks the sweep
  (`assertScanComplete`);
- the largest safe transaction is attempted first, sized from the exact measured
  weight of the serialized transaction (never a fixed per-input rule), keeping a
  safety margin below the 400,000 WU relay limit;
- if Xverse rejects a large payload, the app re-plans the same wallet into the
  minimum number of batches and they are signed sequentially;
- the full pre-sign disclosure (UTXOs, inscriptions, total in, destination, exact
  fee, fee % of recovered BTC, output, vsize, weight, batch count) is shown
  before signing;
- Xverse signs every listed input index with `broadcast: false`;
- each returned PSBT is decoded and independently verified, including every
  Schnorr signature, before anything else can happen;
- only a verified transaction is finalized and serialized, and the final review
  shows its input count, input sats, destination, output sats, mining fee, fee %,
  vsize and txid;
- broadcasting is never automatic: it needs a second operator opt-in
  (`NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST`), a per-transaction user authorization,
  and it submits the exact verified bytes to independent public nodes only once;
- a mismatched or ambiguous response is never followed by a resubmission;
- after submission, an explicit **Check confirmation** action looks the txid up on
  the same independent nodes (mempool or confirmed, with the block height when
  reported) without ever submitting anything.

### M6: local distribution and release candidate

The app is distributed by cloning the public repository and running it locally,
not by deploying a site. There is no domain, no hosted build, no account and no
server component.

- `scripts/start-local.mjs` is the front door. It sets the three product flags
  itself so no one has to hand-edit `.env.local`, prints exactly what it is about
  to enable, defaults to a mode that cannot spend anything, and binds to
  `127.0.0.1` — the hostname is deliberately not configurable so it cannot be
  exposed on a network interface by accident. `--mode=broadcast` refuses to start
  without a typed confirmation.
- `scripts/check-environment.mjs` checks the toolchain read-only and prints the
  ordinary per-platform install command for anything missing.
- `docs/LOCAL_SETUP.md` documents both the simple path (`corepack enable`,
  `pnpm install`, `pnpm local`) and the manual `--frozen-lockfile` path.
- `docs/MANUAL_ACCEPTANCE.md` is the operator-assisted suite for the parts no
  offline test can reach (a live Xverse wallet). All nine cases have been
  operator-reported and **none is formally verified**; each is recorded as
  `PROVISIONAL PASS`, which moves no gate. The artifacts that would change that are
  listed inside it under *Evidence still outstanding*.
- `docs/AUDIT_HANDOFF.md` is the brief for an independent reviewer, not a review.
- `docs/RELEASE_NOTES_v0.1.0-rc.1.md` is the prepared, **unpublished**, source-only
  release candidate.

Linux (Fedora 43, x86_64) is verified end to end. Windows and macOS are recorded
as **NOT VERIFIED** in [`docs/RELEASE_GATES.md`](RELEASE_GATES.md) (gates K9/K10)
because no environment was available to install and run the tool on either.

## Documentation map

| Document | What it answers |
| --- | --- |
| [`docs/RELEASE_GATES.md`](RELEASE_GATES.md) | What is PASS / FAIL / NOT VERIFIED, with evidence, and what still blocks launch |
| [`docs/SECURITY_REVIEW.md`](SECURITY_REVIEW.md) | The internal security review: method, findings, fixes, and what was not examined |
| [`docs/MAINNET_ACCEPTANCE.md`](MAINNET_ACCEPTANCE.md) | The confirmed Mainnet sweep: raw endpoint evidence, byte-level re-derivation, accounting, and what it does not prove |
| [`docs/PERFORMANCE.md`](PERFORMANCE.md) | Measured large-wallet acceptance from 1 to 10,000 UTXOs |
| [`docs/RISK.md`](RISK.md) | The risk disclosure published on the website |
| [`docs/PUBLIC_BETA.md`](PUBLIC_BETA.md) | Beta readiness, launch blockers and the unsigned-transaction persistence design |
| [`docs/DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Tokens, typography and motion rules shared by both routes |
| [`docs/LOCAL_SETUP.md`](LOCAL_SETUP.md) | How to install and run the app locally, per platform |
| [`docs/MANUAL_ACCEPTANCE.md`](MANUAL_ACCEPTANCE.md) | The operator-assisted manual acceptance suite for the parts no offline test can reach |
| [`docs/AUDIT_HANDOFF.md`](AUDIT_HANDOFF.md) | The brief for an independent Bitcoin security reviewer |
| [`docs/RELEASE_NOTES_v0.1.0-rc.1.md`](RELEASE_NOTES_v0.1.0-rc.1.md) | The prepared, unpublished source-only release candidate |

## Non-goals

- custody
- key generation
- seed import
- pretending inscriptions are deleted
- preserving Ordinal assignment when a user opts into destructive reclaim
- automatic BTC-to-SOL swapping in the core wallet layer

A swap integration can later use any valid BTC deposit address as the sweep
destination.
