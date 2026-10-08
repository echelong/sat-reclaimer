# Security model

Sat Reclaimer is non-custodial and never holds key material.

## Never

- Ask for, derive, import, store, transmit or log a seed phrase or private key.
- Log wallet signatures or full PSBT payloads.
- Send wallet inventory, addresses or holdings to any analytics or server.
- Broadcast automatically, or broadcast at all without passing local verification.
- Resubmit a transaction after an ambiguous network response, or sign a replacement.
- Submit bytes that do not hash to the txid that was independently verified.
- Enable Mainnet silently, or unlock it because tests are green.
- Rewrite, normalise or convert a destination address.
- Select or spend an output the user did not explicitly select.
- Infer that a UTXO is safe, or infer safety from an inscription count.

## Enforced in code

- **Mainnet gate.** `assertNetworkAllowed` throws unless
  `NEXT_PUBLIC_ENABLE_MAINNET === 'true'`. It runs in the connect, scan, build and
  signing layers, not only in the UI, so the gate cannot be bypassed by
  manipulating state. Mainnet is never a default and is never treated as a test
  chain.
- **Scan completeness.** `assertScanComplete` refuses Sweep All unless every
  reported inscription was retrieved. A partial UTXO set would silently leave
  inscriptions behind, so an incomplete scan is a hard block, not a warning.
- **Measured size limit.** `planSweep` finalizes the candidate transaction with
  key-free placeholder signatures and refuses any batch above `MAX_SWEEP_WEIGHT`,
  a safety margin below the 400,000 WU relay limit. The old per-input count caps
  are gone; the real transaction size is the limit.
- **Broadcast gate.** A manual broadcast needs three independent things: explicit
  authorization, a passed verification, and raw bytes whose recomputed hash equals
  the verified txid. Mainnet needs `NEXT_PUBLIC_ENABLE_MAINNET` **and** a second
  `NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST` opt-in; the Signet/Testnet flag can never
  unlock Mainnet. The transaction is submitted at most once per session.
- **Manual, wallet-free broadcast.** `src/lib/broadcast.ts` submits the verified
  raw transaction to independent public Bitcoin APIs for the selected network
  only (a Mainnet transaction can never reach a testnet host, or vice versa).
  Xverse is never asked to broadcast. A returned txid that differs from the
  locally computed one aborts and is never treated as success.
- **No automatic resubmission.** A transport-level failure is answered by
  querying the txid on independent endpoints, never by resubmitting. If no
  endpoint can confirm the txid, the outcome is reported as unknown and the flow
  stops; the app never signs or submits a replacement on its own.
- **Accurate rejection reporting.** Node reject reasons are classified into
  insufficient fee, conflicting inputs, missing/spent inputs and policy
  rejection, and the node's own response is shown verbatim.
- **Address/key proof.** The Ordinals address must be the BIP86 Taproot output of
  the public key Xverse reported. Otherwise nothing is built.
- **Destination validation.** The address must decode on the selected network.
  Wrong-network addresses are rejected with an explicit message; they are never
  converted.
- **Fee-rate ceiling.** 1,000 sat/vB, so a typo cannot burn a wallet.
- **Unique inputs.** Inputs are deduplicated by `txid:vout`; duplicate rows and
  duplicate inscription ids are collapsed.
- **Untrusted indexer data.** Malformed rows, malformed outpoints, invalid
  postage, outputs belonging to another address, and two rows that disagree
  about an output's value are quarantined and reported. A single bad row cannot
  abort a 1,000-inscription scan.
- **No silent burn.** If the remainder after fees falls below the dust/relay
  threshold, the estimator would produce a zero-output transaction paying
  everything to miners. The builder detects this and refuses.
- **Independent verification.** Every transaction is decoded from its serialized
  PSBT, never from the state that built it. The verifier re-reads inputs, prevout
  values, scripts, the single output, the destination script, the amount and the
  fee, and it recomputes the BIP341 sighash itself rather than trusting the
  library that assembled the transaction.
- **Signature verification.** Each input needs a 64- or 65-byte Schnorr
  signature that verifies against its Taproot output key. Sighash types other
  than `SIGHASH_DEFAULT` and `SIGHASH_ALL` are rejected, because
  `NONE`/`SINGLE`/`ANYONECANPAY` would let outputs or inputs be substituted after
  signing. Script-path spends are rejected; only key-path is expected.
- **Conservation.** `sum(inputs) = sum(outputs) + fee` is asserted from the
  decoded transaction, and the reported fee must equal the approved fee.

## Signing and broadcasting are separate

`Sign` never broadcasts (`broadcast: false`, always). The signed PSBT is
finalized and serialized only after it passes independent verification, and the
raw transaction is then submitted by `src/lib/broadcast.ts` on a separate,
explicitly authorized, per-transaction user action. The wallet is never involved
in broadcasting, and a signed transaction is submitted at most once.

## Residual risks

- **Asset detection is incomplete.** Runes, BRC-20 state and rare sats cannot be
  detected through the Sats Connect inscriptions API. Any output may carry them.
- **Postage values come from the wallet's indexer.** If an indexer misreports an
  output's value, BIP341 commits to the wrong amount and the transaction is
  rejected by the network rather than spending a wrong value. Conflicting values
  for one output are excluded.
- **Signet and Testnet share address prefixes.** A Testnet address is a valid
  Signet address at the encoding level; this is a Bitcoin property, not a bug.
- **A compromised Xverse or browser extension** is outside the app's trust
  boundary. The local verifier limits the damage: a different destination,
  amount, extra output or extra input is detected before broadcast.
- **Batch weight limits are local.** The 400,000 WU budget is Bitcoin's standard
  limit. Wallet and RPC payload limits are lower and are not yet measured against
  a live wallet.
- **Broadcast endpoints are third-party APIs.** mempool.space and blockstream.info
  are used to submit and to look up a txid. They can be unreachable, rate-limited
  or wrong; the app therefore compares their returned txid with its own and never
  infers success from an HTTP status alone.

## Milestone gate

Mainnet is disabled by default. On 2026-10-08 the operator explicitly enabled
Mainnet for the Sweep All workflow. This is a recorded policy decision, not a
silent bypass. The workflow keeps every local check, retrieves the whole wallet
before building, sizes the sweep from the measured serialized transaction,
requires the full pre-sign disclosure and a destructive-asset acknowledgement,
and independently verifies every signed PSBT before anything else can happen.
Broadcasting is a separate manual step behind a second explicit operator flag
(`NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST`); it is never automatic and never
resubmits after an ambiguous response. An independent Bitcoin security review is
still outstanding.
