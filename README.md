# Sat Reclaimer

Non-custodial web app for deliberately spending the bitcoin locked inside
inscription-bearing Taproot UTXOs.

## Core rule

The app never asks for, derives, stores, transmits or logs a seed phrase or
private key. It connects to Xverse through Sats Connect, enumerates inscription
UTXOs, builds a PSBT, asks the wallet to sign specific Taproot inputs, and then
verifies the signed result locally before anything else can happen.

An inscription-bearing UTXO is still a Bitcoin UTXO. This app does not delete
inscriptions, convert Ordinals into Bitcoin, or take custody. It lets the owner
opt selected `bc1p` outputs back into ordinary coin selection after an explicit
destructive-asset acknowledgement.

## Milestone status

**M0 complete. M1 (signer compatibility proof) is implemented and verified
locally up to the point where a real Xverse wallet must approve a request.**

| Area | Status |
| --- | --- |
| Wallet connection (`wallet_connect`) | Implemented against sats-connect 4.2.1, verified in a browser without a provider installed |
| Ordinals address + Taproot proof | Address is checked to be the BIP86 output of the reported public key before anything is built |
| Inscription pagination | Implemented with page/row/duplicate rails |
| Outpoint deduplication | Implemented, plus duplicate inscription ids, postage conflicts and foreign addresses |
| Exact accounting | `sum(inputs) = sum(outputs) + fee`, re-derived from the serialized PSBT |
| P2TR PSBT construction | `@scure/btc-signer` 2.4.1, one output, exact vsize x fee-rate fee |
| Batching | Input cap + 400,000 WU weight budget; a 901-UTXO wallet splits into 5 buildable batches |
| Local signed-PSBT verification | Independent decode + BIP341 sighash + Schnorr verification of every input |
| Mainnet | Locked in code (`NEXT_PUBLIC_ENABLE_MAINNET`) |
| Broadcast | Disabled by default (`NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST`), Signet/Testnet only |
| Live Xverse signature | **Not yet demonstrated — requires a wallet approval** |

The local signing ladder (1/10/50/100/200/500 inputs) is exercised in tests with
a deterministic test key, not with Xverse. See `tests/psbt.test.ts`.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` runs the full offline suite: 160 tests, no network access, no
mainnet dependency.

## Configuration

Both flags are off unless set to exactly `true`.

```bash
NEXT_PUBLIC_ENABLE_MAINNET=false
NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST=false
```

```bash
NEXT_PUBLIC_ENABLE_MAINNET=true pnpm dev   # only after the milestone gates pass
```

`NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST=true` enables the separate Broadcast step.
Broadcasting is always refused on Mainnet, and it is refused unless the signed
PSBT passed local verification.

## Flow

Connect Xverse → Scan wallet → acknowledge the destructive warning → select
UTXOs → enter a destination address and fee rate → **Build** unsigned PSBTs →
**Sign** with Xverse → the app **verifies** the signed PSBT → **Broadcast**
(separate, gated step).

`Build`, `Sign`, `Verify` and `Broadcast` are separate actions. Nothing is
combined into one opaque button, and signing never broadcasts.

## Trust model

1. Xverse exposes the Ordinals P2TR address and its public key.
2. The app proves the address is that key's BIP86 output, or refuses to continue.
3. `ord_getInscriptions` enumerates inscriptions; every row is treated as
   untrusted input and validated.
4. Rows are reduced to a unique `txid:vout` set. Multiple inscriptions sharing
   one output are counted once.
5. The PSBT is built, then re-decoded from its serialized form; every number the
   user sees comes from that decode.
6. Xverse signs exactly the listed input indexes with `broadcast: false`.
7. The returned PSBT is decoded again and checked against the plan: inputs,
   prevout values, input scripts, single output, destination script, amount, fee,
   conservation, txid, and a Schnorr signature verification per input.
8. Broadcasting, if ever enabled on Signet/Testnet, is a separate gated action.

## Asset warning

**Asset detection is not exhaustive.** The Sats Connect inscriptions API cannot
detect runes, BRC-20 balances or rare sats, so the app never claims any output is
safe and never infers safety from an inscription count. Spending an
inscription-bearing output can move or permanently affect everything it carries.
The user must explicitly acknowledge that before UTXOs become selectable.

## API notes (verified against the installed packages)

Checked against `sats-connect@4.2.1` and `@scure/btc-signer@2.4.1` type
declarations rather than examples found online:

- `request(method, params)` is re-exported from `@sats-connect/core` by
  `sats-connect`; the singleton `Wallet` class is the other entry point.
- `wallet_connect` takes `{ addresses, message (≤80 chars), network }` and returns
  `{ addresses[], walletType, network.bitcoin.name }`. The reported network is
  compared with the requested one and a mismatch stops the flow.
- `ord_getInscriptions` takes `{ offset, limit }` and returns
  `{ total, limit, offset, inscriptions[] }`.
- `signPsbt` takes `{ psbt, signInputs: { [address]: number[] }, broadcast }` and
  returns `{ psbt, txid? }`. There is no `finalize` option in this version.
- `wallet_disconnect` takes `null | undefined`.
- `selectUTXO(..., 'all', ...)` is the exact fee/vsize estimator used for
  building. Its weight for a one-output P2TR sweep matches the signed transaction
  exactly, and a 500-input batch is 115,214 WU against a 400,000 WU limit.
- If the remainder after fees is below the dust/relay threshold the estimator
  emits **zero outputs and burns the whole batch as fee**. The builder detects
  that and refuses instead.

## Tooling

Node 22, `pnpm@10.17.1`. `@noble/curves` and `@noble/hashes` are direct
dependencies (same versions `@scure/btc-signer` already pins) so the verifier can
compute its own BIP341 sighash and check Schnorr signatures.

## Before mainnet

Independent Bitcoin security review, a live Xverse signing run on Signet, a
confirmed Signet transaction, and a deliberate manual decision to unlock the flag.
