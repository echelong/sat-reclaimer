# Bitcoin security review

Scope: the whole transaction lifecycle — **CONNECT → SCAN → SELECT → BUILD →
REVIEW → SIGN → VERIFY → BROADCAST → CONFIRM** — as implemented in `src/lib` and
wired by `src/components/Reclaimer.tsx` and
`src/components/console/ImportTransaction.tsx`.

This is an internal review by the author of the code. **It is not an independent
external audit**, and no gate that depends on external review may be recorded as
passed on the strength of this document. Every finding below is either fixed with
a regression test in `tests/security-regressions.test.ts` or explicitly recorded
as unverifiable.

## Method

Read the code, then try to break it rather than to confirm it. Three questions
were asked of every stage:

1. **What happens if the other side lies?** The indexer, the wallet and the public
   broadcast nodes are all untrusted inputs.
2. **What happens if the code is wrong?** Every number the user sees must be
   re-derived from the serialized artifact, not from the object that produced it.
3. **What happens if the process is interrupted or repeated?** Interrupted batches,
   duplicate clicks and ambiguous network answers are the realistic failure modes.

## Findings

### F1 — A postage conflict could be undone by a later row (High) — FIXED

`scanInscriptionUtxos` excludes an output when two indexer rows disagree about its
value, because the true value is then unknown. The exclusion was implemented by
deleting the outpoint from the accumulator, which meant a **third** row carrying
either of the two conflicting values re-created the output with an unverified
amount. A provider that repeats a value after a conflict therefore reintroduced
exactly the output the conflict rule exists to remove.

Fixed by recording conflicted outpoints in a `conflicted` set that persists for the
rest of the scan; each subsequent row for that outpoint is quarantined instead.
Test: `F1: postage conflict cannot be undone by a later row`.

Impact before the fix: the sweep could include an input whose real value is
unknown. The BIP341 signature commits to the prevout amount, so the resulting
transaction would be rejected by consensus rather than spending the wrong amount —
a correctness and availability defect, not a path to fund loss.

### F2 — The outpoint-set comparison was one-directional (Medium) — FIXED

`verifySignedPsbt` checked the decoded outpoints by length plus "every decoded
outpoint is one of the expected ones". That is not set equality: a wallet returning
input 0 twice and dropping input 1 satisfies it whenever the two duplicated inputs
had equal values. The case was still caught downstream by the `txid-stable` check,
but the guard meant to catch a mutated input set could be satisfied by one that had
been mutated. Fixed to compare both directions, including set cardinality.

### F3 — No explicit dust assertion on the destination output (Medium) — HARDENED

The builder relied on `selectUTXO` collapsing a below-dust remainder into the fee
and producing zero outputs, then refused when it saw zero outputs. That is correct
behaviour today, but it is a property of the library: a library change that emitted
a sub-threshold output instead would produce a transaction no node relays and no
recipient wallet can spend.

Fixed by reproducing Bitcoin Core's `GetDustThreshold` locally
(`dustThresholdSats`) and refusing any built output below it, with a new
`DUST_OUTPUT` error. Verified values: 330 sats for a P2TR output, 294 for P2WPKH,
540 for P2SH, 546 for P2PKH.

**Reachability, stated honestly:** with `@scure/btc-signer@2.4.1` the guard is not
reachable — probing destinations across three script types and amounts from 400 to
1,200 sats showed the library collapsing the remainder at exactly the Core
threshold, so the pre-existing `FEE_EXCEEDS_VALUE` path fires first. The test
covers the threshold function directly and the unreachable guard's precondition;
the guard itself is verified by inspection, not by a live failure.

### F4 — Nothing asserted that the fee covers the transaction's own measured size (Medium) — HARDENED

The builder verified that the library's fee equaled the decoded PSBT's implied fee,
and separately that the app's own weight model equaled the library's. It never
asserted the relationship that actually matters to a user: `fee ≥ vsize(measured
finalized weight) × fee rate`. An underpaid transaction is the failure mode that
matters here — it looks fully verified locally and then sits unrelayed.

Added as an explicit assertion. Measured before adding it: for 1 / 10 / 100 / 500
inputs at 1, 2, 5 and 37 sat/vB the delta between the built fee and
`vsize × rate` was **0 in all 16 combinations**, so this is a guard against a
future regression rather than a fix for a live defect. The exact-equality contract
is now also asserted in `tests/security-regressions.test.ts` so a library upgrade
that changes it fails loudly.

### F5 — The P2TR witness-program shape was only half-checked (Low) — FIXED

The signature probe required a 34-byte script beginning `0x51`, but did not check
that the following opcode actually pushes 32 bytes (`0x20`), so a malformed 34-byte
`0x51` script could reach the Schnorr verification path instead of being rejected
as a non-P2TR input. Fixed; the check is asserted through the verifier's own error
text.

### F6 — An unparseable status body was reported as "in the mempool" (Low) — FIXED

`checkTxidStatus` treated any HTTP 200 as proof the endpoint knows the txid, and
defaulted `confirmed` to `false` when the body did not parse. A proxy or
rate-limit page returning 200 would therefore be reported to the user as *"in its
mempool, not yet confirmed"* — a fabricated on-chain observation, and the exact
opposite of the app's stated policy of not claiming unverified chain state.

Fixed: an endpoint only answers when the body is an object carrying a **boolean**
`confirmed`; anything else is inconclusive and the next endpoint is asked. Two
regression tests cover both the ambiguous and the genuine case.

### F7 — Submission did not require a finalized transaction (Medium) — FIXED

`broadcastRawTransaction` re-derived the txid from the raw bytes and compared it
with the expected txid, which binds the submitted bytes to the reviewed txid. It
did not check that the bytes were a *signed* transaction: an unsigned
serialization of the same transaction hashes to the same txid and would have been
posted to nodes, which then reject it for reasons that look like censorship or
policy problems. Fixed with `assertFinalizedTransaction`, which requires at least
one input, at least one output and a non-empty witness on **every** input — true by
construction for this app's Taproot key-path sweeps. `txidFromRawTransaction`
remains a pure hasher so it can still be used on unfinalized bytes for inspection.

### F8 — The wallet payload-limit fallback could only fire once (Low, reliability) — FIXED

If Xverse rejects a large PSBT as too big, the console re-plans the same wallet
into smaller batches. That fallback was gated on the plan still being a single
transaction, so after the first re-plan a second rejection could not be answered —
a wallet with a much lower practical limit than the relay policy would dead-end
instead of completing one `Sweep All` workflow. Fixed to halve the largest batch
repeatedly while it is still larger than a single input, rebuilding and re-measuring
from scratch each time and never relaxing validation.

### F9 — Rows with no address were silently treated as verified (Low, transparency) — FIXED

The connected-address check only applies when the indexer supplies an address. Rows
without one were accepted silently, so the scan summary could imply every UTXO had
been confirmed as belonging to the connected Ordinals address when it had not.
`ScanResult.unverifiedAddressCount` now reports the count and the console explains
what it means. The spend itself was never unsafe — every input script is re-checked
against the derived Ordinals script before signing and each signature is verified
afterwards — but the claim was stronger than the evidence.

Also fixed alongside it: the address comparison was case-sensitive. Bech32 and
bech32m (BIP173) are explicitly case-insensitive, so a provider that up-cased an
address would have had the user's own UTXOs quarantined as foreign. The comparison
now normalizes case, which is correct rather than more permissive.

### F10 — A raw transaction carries no network (informational)

While building the import flow, a design assumption was found to be wrong: it is
not possible to determine from transaction bytes which chain a transaction belongs
to. Output scripts carry no network information — the same script is a valid
mainnet and testnet output, and only the *address encoding* differs. An attempted
`detectNetwork` helper was removed rather than shipped as a check that cannot fail,
and the import flow now states plainly that the network cannot be verified and
that a node on the wrong chain rejects the transaction outright. This is recorded
because a check that silently always passes is worse than no check: it manufactures
confidence.

## Properties examined and found sound

- **Indexer value spoofing cannot steal funds.** BIP341 commits to every prevout
  amount in the signature digest. A hostile indexer that inflates or deflates an
  input's reported value produces a transaction whose signature is invalid under
  consensus *and* which the app's own verification rejects against the declared
  value. The two failure modes are "transaction rejected" and "verification
  failed", never "funds redirected".
- **The verifier never reads application state.** Every input, prevout value,
  script, output, amount, fee, txid, weight and signature is re-read from the
  serialized PSBT, so a preview cannot disagree with the artifact the wallet is
  asked to sign.
- **Finalization is gated on verification.** A transaction that fails any check is
  never converted into broadcastable bytes; the `extractable` check is skipped with
  an explanation instead.
- **Authorization is bound to the exact bytes.** Broadcast requires a passed
  verification, an operator flag, a per-txid authorization checkbox, and a locally
  recomputed txid that must equal the authorized one. A mismatch aborts before
  anything is sent.
- **No resubmission, ever.** An ambiguous or timed-out POST is resolved by looking
  the txid up on the same independent nodes. A rejected submission is reported
  verbatim and never retried, and the app never signs a replacement.
- **Duplicate protection is layered.** Inputs are deduplicated by `txid:vout` in
  the scan reduction, again by `uniqueByOutpoint` in the planner, and a third time
  by an explicit duplicate-input check in the builder. An accepted transaction is
  memoized per txid per session and is never submitted twice, including from the
  import flow, which shares the same ledger.
- **The operator flags are not treated as a security boundary.**
  `NEXT_PUBLIC_*` values are public browser configuration. Mainnet and Mainnet
  broadcasting are gated by them as a matter of product policy, and the real
  boundary — the one that cannot be bypassed by editing a value — is the wallet
  approval itself, plus the independent verification that happens after it.
- **No key material anywhere.** No seed phrase, mnemonic, private key or derived
  secret is requested, held, logged or transmitted. `signPsbt` always sends
  `broadcast: false`, so signing cannot broadcast as a side effect.

## Not verified — recorded as open

| Item | Why it matters | Status |
| --- | --- | --- |
| Independent external security audit | Self-review cannot substitute for it | **NOT VERIFIED** |
| Live Xverse signing approval | No signature has been observed in this environment; the extension flow cannot be driven here | **NOT VERIFIED** |
| Xverse's real PSBT payload limit | Decides how many batches a large wallet needs; only mock signing has been exercised | **NOT VERIFIED** |
| `sats-connect` and Xverse internals | Treated as a trusted dependency: responses are validated, the implementation is not reviewed | **NOT VERIFIED** |
| Signet/Testnet end-to-end path | No inscription-bearing Signet UTXO exists to sweep | **NOT VERIFIED** |
| Broadcast endpoint censorship / availability | Two independent operators are used, but either can refuse to relay | Accepted risk |
| Browser-extension supply chain | Outside this codebase | Accepted risk, documented for users |

## Reproducing

```bash
pnpm typecheck                 # strict TypeScript, no suppressions
pnpm lint
pnpm test                      # includes tests/security-regressions.test.ts
pnpm build
```

`tests/security-regressions.test.ts` names every finding above, so a refactor that
reopens one fails the suite rather than the field.

## M9 continuation — internal findings, 2026-10-09

These changes are internal validation, not an external audit.

- **Silent fee rounding:** `1.5 sat/vB` became `2 sat/vB` in the console.
  `parseFeeRate` now rejects fractional input instead of changing the requested
  rate. Regression: `tests/sweep-session.test.ts` and console-handler tests.
- **Repartitioning signed inputs:** a later payload rejection rebuilt every
  batch and discarded earlier signed reports and broadcast outcomes.
  `replanAfterSizeRejection` refuses once any signing report exists, retaining
  recoverable bytes. An unsigned replan clears the signing phrase and requires
  review of the newly measured aggregate fee. Cancellation and timeout cannot
  trigger this fallback. Regression: sweep-session and wallet tests.
- **Stale state:** changing network, failed reconnect, failed rescan or failed
  provider disconnect could leave old wallet/scan data usable. These paths now
  clear local state before requesting new data; recovery authorization resets
  when its network changes. A synchronous operation lock prevents double
  connects before React renders disabled controls. Regression: console tests.
- **Recovery authorization:** the import handler now enforces its checkbox,
  phrase, inspection and busy guards at invocation, and editing raw bytes
  clears the prior report and authorization. File-read failures are reported.
- **Audit failure treated as success:** a valid registry-error JSON response
  lacked `advisories` and was interpreted as an empty audit. The gate now
  requires a complete report and advisory details for reported high/critical
  findings. Regression: `tests/audit-allowlist.test.ts`.

Signed transactions are spendable authorizations, even before submission. Export
files contain no private keys but must be handled deliberately. After a submitted
or ambiguous transaction, look up the txid before rebuilding over its inputs.

- **Incomplete scan mislabeled complete:** `Number(null)` interpreted an unknown
  provider total as zero, stopping after the first page. Null/absent totals now
  require an explicit empty page. Invalid totals fail; changing totals or more
  rows than the reported total mark the scan incomplete. Regressions cover these
  cases in `tests/ordinals.test.ts`.

- **Automatic second POST after ambiguity:** the broadcast loop tried the second
  endpoint after a transport failure at the first. Its single-endpoint timeout
  test did not exercise this. M9 replaces submission fallback with independent
  GET status lookups and records all attempted txids, including failed and
  ambiguous attempts, for the session. Repeated POSTs and re-signing attempted
  native batches are refused; status checking remains available in both flows.
  Regression: multi-endpoint 503 recovery plus timeout/503/rejection/txid-mismatch
  attempt-ledger cases in `tests/broadcast.test.ts` and console-handler tests.
