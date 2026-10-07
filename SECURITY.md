# Security model

Sat Reclaimer is non-custodial and never holds key material.

## Never

- Ask for, derive, import, store, transmit or log a seed phrase or private key.
- Log wallet signatures or full PSBT payloads.
- Send wallet inventory, addresses or holdings to any analytics or server.
- Broadcast automatically, or broadcast at all without passing local verification.
- Enable Mainnet silently, or unlock it because tests are green.
- Rewrite, normalise or convert a destination address.
- Select or spend an output the user did not explicitly select.
- Infer that a UTXO is safe, or infer safety from an inscription count.

## Enforced in code

- **Mainnet gate.** `assertNetworkAllowed` throws unless
  `NEXT_PUBLIC_ENABLE_MAINNET === 'true'`. It runs in the wallet layer, not only
  in the UI, so the gate cannot be bypassed by manipulating state.
- **Broadcast gate.** Refused on Mainnet unconditionally; otherwise requires the
  build flag *and* a passed verification.
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

`Sign` never broadcasts (`broadcast: false`), and the signed PSBT is verified
before the UI enables a (still gated) `Broadcast` action.

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

## Milestone gate

Mainnet stays disabled until: construction and fee tests pass, signed-PSBT
verification passes, Xverse signs real inscription Taproot inputs, a Signet
transaction confirms, a security review passes, and Mainnet is enabled
deliberately.
