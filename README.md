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

## Product surface

| Route | What it is |
| --- | --- |
| `/` | Public landing page: hero with an animated UTXO→consolidation visualisation, the four-step workflow, a fully simulated interactive demo, the problem statement, the trust and security posture, and a 13-question FAQ |
| `/app` | The working reclaim console (moved here from `/`) |

`/` is what people arriving from a shared screenshot see first, so it explains the
product and its limits before asking anyone to connect a wallet. The console is
unchanged where it counts: same wallet, PSBT, signing, verification and broadcast
code, same opt-in gates, same destructive acknowledgement.

The visual language is one system shared by both routes — see
[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). Styling is plain CSS
(`app/globals.css`, `app/landing.css`, `app/console.css`); there is no CSS
framework and no animation dependency.

## Milestone status

**M0 complete. M1 (signer compatibility proof) is implemented and verified
locally. The operator has enabled Mainnet for the Sweep All workflow.**

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
| Mainnet | Off by default; operator-enabled Sweep All (`NEXT_PUBLIC_ENABLE_MAINNET`) |
| Broadcast | Manual, disabled by default; Mainnet requires a second opt-in (`NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST`) and submits the verified raw transaction to independent public nodes |
| Live Xverse signature | **Not yet demonstrated — requires a wallet approval** |

The local signing ladder (1/10/50/100/200/500 inputs) is exercised in tests with
a deterministic test key, not with Xverse. See `tests/psbt.test.ts`.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:3000  → landing
                # http://localhost:3000/app → reclaim console
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Set `NEXT_PUBLIC_SITE_URL` to the real origin before any public deployment; it is
what canonical URLs, `og:url` and `sitemap.xml` are built from. Without it they
fall back to `http://localhost:3000`.

### Social preview image

`public/og.png` (1200×630) is generated from `scripts/social-preview.html`, a
standalone card kept out of the app so the composition is exactly the right size
with no half-finished entry animation:

```bash
chromium-browser --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=6000 \
  --screenshot=public/og.png "file://$PWD/scripts/social-preview.html"
```

The card's headline is sized to measure ~820 px against a 1048 px column, so it
stays on one line; widening the type or narrowing the column wraps it and breaks
the strike-through placement.

`pnpm test` runs the full offline suite: 199 tests, no network access, no
mainnet dependency. The broadcast tests use a fake transport, so no live
endpoint is ever contacted.

## Configuration

Both flags are off unless set to exactly `true`.

```bash
NEXT_PUBLIC_ENABLE_MAINNET=false
NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST=false
NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST=false
```

Mainnet broadcasting needs both Mainnet flags. The Signet/Testnet flag can never
unlock Mainnet.

```bash
NEXT_PUBLIC_ENABLE_MAINNET=true NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST=true pnpm dev
```

## Sweep All

One workflow retrieves and sweeps an entire wallet:

1. **Scan the whole wallet.** Pages are fetched until the indexer total is
   exhausted or the provider returns an empty page. The app reports the
   indexer-reported total, inscriptions retrieved, unique UTXOs, total sats,
   pages read and duplicates skipped, and it refuses to sweep an incomplete scan.
2. **Sweep All.** Every retrieved UTXO goes into the sweep — no manual
   repartitioning and no bulk checkbox clicking.
3. **Sized by measurement.** The planner attempts the whole selection as one
   transaction, injects key-free placeholder signatures of the exact size Xverse
   returns, finalizes it, and reads the real relay weight from the serialized
   artifact. 1,083 × 10,000-sat inputs measure 249,312 WU (62,328 vB) and fit in
   **one** transaction.
4. **One-click fallback.** If Xverse rejects a large payload, the app classifies
   the rejection and re-plans the same wallet into the minimum number of batches,
   presented as Batch 1…N. No validation is relaxed to make a rejection pass.
5. **Aggregate fee economics.** The fee check evaluates the whole selected set,
   so 1,083 small UTXOs are a valid sweep even when any one of them alone is not.

### Mainnet

Mainnet is never a default. Setting `NEXT_PUBLIC_ENABLE_MAINNET=true` enables the
same Sweep All workflow on Mainnet, with `MAINNET — REAL BTC` shown throughout, an
extra Mainnet-only destructive acknowledgement, destination validation on
Mainnet, exact fee accounting, and independent verification of every signed PSBT.

Broadcasting is a separate, manual step. `NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST=true`
enables it on Signet/Testnet; Mainnet additionally requires
`NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST=true`, so enabling Mainnet for building
never moves real BTC by itself. Once a batch verifies, the app shows the final
review (input count, input sats, destination, output sats, mining fee, fee %,
vsize, txid), requires a per-transaction authorization for that exact txid, and
only then submits the raw bytes to independent public Bitcoin nodes
(mempool.space, then blockstream.info). Xverse is never asked to broadcast.

A returned txid that does not match the locally computed one is treated as a
failure, not a success. A submission that times out is resolved by looking the
txid up on the same independent nodes — never by resubmitting. After a
submission, **Check confirmation** asks the same independent nodes whether the
txid is in a mempool or in a block, and reports the block height when known. The
app never rebroadcasts automatically and never signs a replacement.

## Flow

Connect Xverse → Scan wallet → acknowledge the destructive warning → select
UTXOs → enter a destination address and fee rate → **Build** unsigned PSBTs →
**Sign** with Xverse → the app **verifies** the signed PSBT → review the exact
verified transaction → authorize that txid → **Broadcast** to independent nodes.

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
8. Broadcasting is a separate action behind two explicit operator flags and a
   per-transaction authorization. The verified raw bytes are re-hashed locally
   and POSTed to independent public nodes; the wallet never broadcasts, a
   mismatched returned txid aborts the flow, and an ambiguous response is
   resolved by a txid lookup rather than a resubmission.

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

The operator enabled Mainnet deliberately for the Sweep All workflow (a recorded
policy decision). Broadcasting real BTC is behind a second, separate operator
flag and a per-transaction authorization, and it has not yet been exercised
against a live wallet or a live broadcast endpoint. Independent Bitcoin security
review is still outstanding.

## Public beta

Before this is announced:

- **Do not describe it as audited, certified or risk-free.** The landing page says
  "Not audited" under Trust & Security and names what the app cannot verify.
- **Never present gross input sats as recovered bitcoin.** Net output is
  `inputs − mining fee`, and the demo shows that arithmetic explicitly.
- **Do not claim a broadcast confirmed** without checking its on-chain status on
  independent nodes.
- A signed transaction lives in browser memory only, so a refresh discards it. The
  console offers *Download verified .hex* (a raw transaction is public network
  data and contains no key material), and the proposed persistent recovery design
  is written up — but not implemented — in
  [`docs/PUBLIC_BETA.md`](docs/PUBLIC_BETA.md).

`docs/PUBLIC_BETA.md` also carries the ordered list of remaining launch blockers.
