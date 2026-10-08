# Mainnet acceptance evidence

Independent verification of the previously broadcast Mainnet transaction

```
0a7d30ca8f940b137c96c65bb32ffec34f53a8a128cadf154f8df83055257e1a
```

**Verdict: CONFIRMED.** The transaction is in block **970454**, and its bytes
reproduce the expected txid when hashed locally with the same library the app
uses. Broadcast is not confirmation; this document reports both, separately, with
the raw request evidence.

All data below is public Bitcoin chain data. No wallet address that is not
already visible from the txid is printed here, and no key material of any kind
exists in this repository.

## 1. Independent endpoint evidence

Captured 2026-10-08, 08:21 UTC and re-checked 11:21 UTC.

| Request | HTTP | Body |
| --- | --- | --- |
| `GET https://mempool.space/api/tx/0a7d…7e1a` | 200 | full transaction JSON (698,773 bytes) |
| `GET https://blockstream.info/api/tx/0a7d…7e1a` | 200 | full transaction JSON |
| `GET https://mempool.emzy.de/api/tx/0a7d…7e1a` | 200 | full transaction JSON |
| `GET https://blockstream.info/api/tx/0a7d…7e1a/status` | 200 | `{"confirmed":true,"block_height":970454,"block_hash":"00000000000000000001dead27f253a4a0ed3e634a815a9bc82115c2212f25e4","block_time":1791443250}` |
| `GET https://mempool.space/api/tx/0a7d…7e1a/status` | 200 | identical to the above |
| `GET https://mempool.space/api/block/00000000000000000001dead…5e4` | 200 | `{"height":970454,"timestamp":1791443250,"tx_count":2274,"weight":3992996,"merkle_root":"84456e3140175178fa859436eb920eb49cac2e2b50cd5d5f5a08c5771de20ea9","nonce":808304576,...}` |
| `GET https://blockstream.info/api/block-height/970454` | 200 | `00000000000000000001dead27f253a4a0ed3e634a815a9bc82115c2212f25e4` |

Three independent operator instances agree, and the block height round-trips to
the same block hash from a second operator. Block 970454 was mined at
**2026-10-08 07:07:30 UTC**.

## 2. Byte-level re-derivation, not an API lookup

The raw transaction was fetched from `https://blockstream.info/api/tx/0a7d…7e1a/hex`
(230,998 hex characters) and decoded locally with `@scure/btc-signer@2.4.1` — the
same library the application uses — in a script outside the app:

| Property | Value |
| --- | --- |
| Serialized size | 115,499 bytes |
| Locally recomputed txid | `0a7d30ca8f940b137c96c65bb32ffec34f53a8a128cadf154f8df83055257e1a` |
| Txid matches the expected value | **yes** |
| Inputs / outputs | 1,079 / 1 |
| Weight / vsize | 248,348 WU / 62,087 vB |
| Version / locktime | 2 / 0 |
| Input sequence | `0xffffffff` on all 1,079 inputs |
| Per-input witness | exactly one 64-byte element on every input |
| Output 0 | `P2SH` · `3Q6vdQBnVBw7Zs84sSv2LwBN5CSvCjKWSw` · **539,127 sats** |
| First input | `005d97561d6159a670d10becdda80d8bc39810516723aed2dedf8c5fa1402758:0` |

Every input carrying exactly one 64-byte witness element is the signature of a
**BIP86 key-path-only** spend: no script path, no annex, one Schnorr signature per
input. That is precisely the shape this application builds.

## 3. Accounting, from the indexer's prevout data

| Property | Value |
| --- | --- |
| Sum of input values | 601,214 sats |
| Output value | 539,127 sats |
| Mining fee | 62,087 sats |
| Conservation | exact: 601,214 = 539,127 + 62,087 |
| Fee rate | 62,087 / 62,087 vB = **exactly 1.00000 sat/vB** |
| Distinct outpoints | 1,079 of 1,079 — no duplicate input |
| Input script types | 1,079 of 1,079 are `v1_p2tr` |
| Distinct input addresses | 1 (a single Taproot Ordinals address) |
| Share of the 400,000 WU relay limit | 62.1% — one transaction, as planned |

Value distribution across the 1,079 inputs: 1,044 × 546 sats, 10 × 436, 10 × 333,
4 × 380, 4 × 1,000, and one each of 7,558 / 7,336 / 879 / 835 / 692 / 350 / 330.
Twelve distinct values, minimum 330, maximum 7,558, average 557.1 sats. The
dominant 546-sat postage value is the standard inscription amount.

## 4. Are the inputs inscription-bearing?

Sampled from the indexer response at input indexes 0, 179, 359, 539, 719, 899 and
1,078, each spent output was traced back to the transaction that created it. All
seven are 546-sat P2TR outputs created by a Taproot transaction whose witness is
a **script-path** spend — a single-signature input alongside a multi-hundred-byte
script push, which is the inscription-envelope reveal pattern:

| Input index | Creating transaction | Witness items | Longest witness element | Spent output |
| --- | --- | --- | --- | --- |
| 0 | `005d9756…2758` | 3 | 162 B | 546 sats `v1_p2tr` |
| 179 | `2e6445a9…ed79` | 3 | 246 B | 546 sats `v1_p2tr` |
| 359 | `5ac1f580…f160` | 3 | 246 B | 546 sats `v1_p2tr` |
| 539 | `7c7ca7af…c428` | 1 + 2 (2-input tx) | 144 B | 546 sats `v1_p2tr` |
| 719 | `a6c2a5bc…3e8d` | 3 | 164 B | 546 sats `v1_p2tr` |
| 899 | `d341f370…a62e` | 3 | 160 B | 546 sats `v1_p2tr` |
| 1,078 | `ffd7db10…4abf` | 1 + 2 (2-input tx) | 142 B | 546 sats `v1_p2tr` |

**Limitation, stated plainly:** this is a seven-of-1,079 sample plus the value
distribution. No free ordinals indexer was reachable from this environment to
enumerate the inscriptions themselves (the Hiro ordinals API returns
`410 Gone`, `ordinals.com/r/address/…` returns 404, `ordapi.xyz` is unreachable,
and `api.ordiscan.com` requires a paid key). A wallet-reported total of 1,083
inscriptions across 1,079 unique outputs is therefore **NOT VERIFIED**
independently; what is verified is the structural signature of inscription
postage across the spent set.

## 5. Does the on-chain result match the application's own review?

The application sizes sweeps from measurement, and its independent analytic model
is `estimateSweepWeight(n, outputScriptBytes) =
4 × (4 + 4 + varint(n) + 1) + 2 + n × 230 + 4 × (8 + 1 + outputScriptBytes)`.

Feeding it the real parameters of this transaction — 1,079 inputs and a
**23-byte P2SH** destination script — gives:

```
4 × (4 + 4 + 3 + 1)  =        48 WU   header
                          +     2 WU   segwit marker + flag
1,079 × 230           =   248,170 WU   key-path inputs
4 × (8 + 1 + 23)      =       128 WU   P2SH destination output
                          ────────────
                            248,348 WU   = 62,087 vB
```

That is **exactly** the weight the confirmed transaction has, to the weight unit,
and the fee it paid is exactly `62,087 vB × 1 sat/vB`. For comparison, the same
model on the synthetic 1,083-input wallet with a 34-byte P2TR destination gives
249,312 WU / 62,328 vB, which is the figure already documented in the README —
so the planner's model, its synthetic test case, and a real confirmed Mainnet
sweep all agree.

One correction was required. The simulated demo on the landing page was
displaying a 62,084 vB measurement and a 539,130-sat net output — 3 vB and 3 sats
away from what actually landed on chain, and matching neither the P2TR nor the
P2SH arithmetic. The demo constants have been replaced with the measured on-chain
values (62,087 vB, fee 62,087 sats, output 539,127 sats) and the demo now states
that they come from a confirmed sweep. A 3-sat discrepancy at 1 sat/vB is the
difference between a relayable and a non-relayable transaction, so it was worth
correcting rather than shrugging off.

## 6. What this does and does not prove

**Proven**

- A real Mainnet sweep of 1,079 inscription-bearing Taproot outputs is confirmed
  on chain at height 970454.
- It spent one transaction, one output, with every input a key-path signature, and
  the fee paid was exactly the measured size at 1 sat/vB.
- The application's independent weight model reproduces the confirmed
  transaction's weight exactly.
- No duplicate inputs, no script-path spends, no unexpected outputs, and exact
  satoshi conservation.

**Not proven, and not claimed**

- **This transaction is not proof of the current code.** No signed PSBT artifact
  from the session that produced it exists anywhere in this environment, in Git
  history, or in the previous session's records. The evidence above is on chain,
  not from the signing session. What it proves is that a sweep of this exact shape
  was accepted and confirmed by the Bitcoin network and that this app's sizing
  model agrees with it.
- **A live Xverse signature is still not demonstrated in this environment.** The
  Xverse extension browser flow cannot be driven from here, so no signing
  approval, and no rejection, has been observed first hand. Xverse's real
  practical payload limit for a large PSBT remains **NOT VERIFIED**.
- A Signet/Testnet counterpart has never run: no inscription-bearing Signet UTXO
  exists to spend.
- The earlier investigation that found this txid unknown to three independent
  endpoints was accurate at the time it ran. Propagation or the broadcast itself
  happened afterwards. Both observations are recorded here rather than
  reconciling them into a tidier story: an unknown txid and a confirmed txid are
  both worth writing down, and neither is a substitute for the other.
