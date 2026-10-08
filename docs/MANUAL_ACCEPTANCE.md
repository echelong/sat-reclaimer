# Manual acceptance suite

Operator-assisted tests for the parts of SAT//RECLAIMER that only a real browser
wallet can exercise: Xverse connection, inscription scanning against the live
provider, signing, and on-chain confirmation.

**All nine cases have now been exercised and reported by the operator, and none is
formally verified.** Every result cell below reads `PROVISIONAL PASS`: the operator
reports the behaviour worked, but the artifacts that would let someone else check
that report — the chain, the browser and wallet versions, a redacted screenshot, the
exact console text, the scan and signature figures, and a txid for anything that
reached a node — have not been supplied for any case. **No release gate has moved on
the strength of these reports, and none should.** This document is a procedure, not
a record. Do not read the presence of a case as evidence that it passed, and do not
close a release gate until its result cell holds a real, checkable observation.

The gates these cases close are listed in [`RELEASE_GATES.md`](RELEASE_GATES.md):
**B5**, **B6**, **C8**, **C9**, **H9**, **H10**, **J2**, **J3**. All of them are
currently **NOT VERIFIED** for the same reason — this repository cannot drive a
browser extension, and no automated test can stand in for a wallet the user
actually approves.

## Evidence still outstanding

Every case below is operator-reported. This is the complete list of what has been
asked for. **Nothing in it is a seed phrase, a private key, a wallet file or any
other confidential material, and none will ever be requested.** A redacted
screenshot is the right way to share a console state: redact addresses and any txid
that is not already public, and never share anything that could reconstruct a key.

| # | Item | Promotes | Can move |
| --- | --- | --- | --- |
| 1 | The **network** actually used, per case (Signet / Testnet / Mainnet) | all | decides whether **C9** is even applicable |
| 2 | **Browser and Xverse versions**, and the commit built (`git rev-parse --short HEAD`) | all | required before *any* row becomes a formal PASS |
| 3 | Whether the wallet **held inscription UTXOs**, with `Indexer reported`, `Inscriptions retrieved`, `Unique UTXOs`, `Pages read`, `Total sats`, and the rescan's numbers | M4 | **H10**, J2 |
| 4 | The **largest PSBT input count Xverse accepted**, the largest it refused, and the exact refusal text | M5 | **B6** |
| 5 | The **exact signing verdict** (`Verified locally: N/N signatures valid, fee … sats, … vB, txid …`) and the independent decode cross-check | M7 | **B5**, **J3** |
| 6 | What the reload did to the signed transaction, the import status line, and the truncated-hex refusal | M8 | nothing — **C8 does not follow from M8** (see the M8 row) |
| 7 | The **M9 txid and its network**, plus the accepting endpoint and the confirmation height | M9 | **J3**, and **C9** if the chain was Signet or Testnet |

**If only one item can be supplied, supply 7.** It is the only artifact on this list
that a third party can check without trusting whoever supplied it: a txid on a stated
chain resolves on a public explorer to a transaction, a block height and a fee,
independently of this repository and of the operator. Every other item is testimony —
worth recording, but it cannot close a gate on its own.

Item 3 matters more than it looks. Earlier in this milestone the wallet under test
was reported as already swept, so whether the M4 scan saw any inscription UTXOs at
all is unresolved — and if it did not, the case exercised the empty-inventory path
only and **H10** (pagination past the provider's page size) was never reached.

When item 7 arrives, this repository will look the transaction up on public
explorers itself and record what they return. It will not create, resubmit or
rebroadcast any transaction to obtain that evidence.

## What the historical Mainnet sweep does and does not cover

The operator previously broadcast and confirmed a 1,079-input inscription sweep:

| | |
| --- | --- |
| txid | `0a7d30ca8f940b137c96c65bb32ffec34f53a8a128cadf154f8df83055257e1a` |
| block | 970454 |
| weight / vsize | 248,348 WU / 62,087 vB |
| inputs / outputs | 1,079 key-path P2TR inputs → one P2SH output of 539,127 sats |

That is real evidence that the flow worked, once, on an earlier version of the
code, driven by an operator who could see the screen. It is **historical
evidence and nothing more**. It does not prove that the current version connects,
scans, signs or broadcasts, and it does not exercise cancellation, recovery,
disconnect/reconnect or network switching at all. Details in
[`MAINNET_ACCEPTANCE.md`](MAINNET_ACCEPTANCE.md).

## Safety rules for the operator

1. **Nothing here must be run on Mainnet with real funds until you have
   deliberately decided to.** Cases M1–M9 are ordered so the first six can be run
   on Signet or Testnet. Only M7 and M9 require a broadcast, and only M9 requires
   a real chain.
2. **Start on Signet or Testnet if you can.** If no inscription-bearing
   Signet/Testnet UTXO exists for the wallet under test, that is itself the
   finding recorded for gate C9, and it is a reason to stop rather than to move
   straight to Mainnet.
3. **This tool never asks for a seed phrase or a private key.** If any screen,
   prompt or error ever appears to ask for one, that is a critical security
   finding: stop immediately and record it as a vulnerability under
   [`SECURITY.md`](../SECURITY.md), not as a failed test.
4. **A broadcast is only ever your own explicit action.** Signing sends
   `broadcast: false` to Xverse, always. Nothing in this application retries,
   rebroadcasts or signs a replacement.
5. **A transaction you sign but do not broadcast does not exist on the network.**
   Closing the tab loses it and costs you a second approval. Your bitcoin is never
   at risk; your time is.
6. **Do not test with a wallet whose inscriptions matter to you.** Spending an
   inscription output can permanently move or affect everything it carries.

## Prerequisites

| Item | Requirement |
| --- | --- |
| Browser | A current Chromium, Firefox or Safari build with the **Xverse** extension installed and unlocked |
| Wallet | Xverse with an **Ordinals (Taproot, `bc1p`/`tb1p`) address** and, for M4/M5/M7, a wallet that actually holds inscription-bearing UTXOs |
| App | `pnpm build && pnpm start`, or `pnpm dev`. Note the URL it prints — the console is at `/app` |
| Flags | Record the three flags you ran with. Cases M7 and M9 need broadcasting enabled for the chain under test (see `docs/LOCAL_SETUP.md`) |
| Chain | Signet/Testnet for M1–M6 and M8. Mainnet only for the final M7/M9 passes, and only by your explicit decision |

Run each case from a **clean console state**: reload `/app` before starting, so a
result cannot be attributed to state left by the previous case.

## How to record evidence

An entry is only evidence if someone else could check it. For every case record:

- **The result**, `PASS` or `FAIL`. Use `BLOCKED` when the case could not be
  started, and say why (no provider, no funded wallet, no Signet UTXO).
- **`PROVISIONAL PASS`** is a separate, weaker status for the one situation where
  the operator reports success but the evidence that would let someone else check
  it — the chain, the browser and wallet versions, a redacted screenshot, the exact
  console text — is still outstanding. A provisional result is recorded so it is not
  lost, and it **moves no gate**: the gate stays `NOT VERIFIED` until the evidence
  arrives and the row is promoted to `PASS`.
- **The exact console error code**, if one appeared. Refusals are prefixed with a
  machine-readable code in brackets, for example `[WALLET_NOT_INSTALLED]` or
  `[SCAN_INCOMPLETE]`. The code is the most useful thing in the record; the prose
  message is not.
- **The txid** for anything that reached a node, and the explorer URL it can be
  checked at.
- **A screenshot** of the console state being asserted, with **wallet addresses
  and any txid that is not already public redacted**. Redacting an address is
  correct. A redacted seed phrase should never exist in the first place.
- **What you ran**: the commit (`git rev-parse --short HEAD`), the browser and
  Xverse versions, the chain, and the three flag values.

The complete list of codes the application can emit. This is the whole
`ReclaimerErrorCode` union from `src/lib/errors.ts`, plus `UNEXPECTED`, which
`errorCode()` returns for anything that is not a `ReclaimerError`:

`MAINNET_DISABLED`, `SCAN_INCOMPLETE`, `BROADCAST_DISABLED`,
`BROADCAST_IN_FLIGHT`, `BROADCAST_REJECTED`, `BROADCAST_TXID_MISMATCH`,
`BROADCAST_UNKNOWN`, `BROADCAST_UNREACHABLE`, `BROADCAST_MALFORMED`,
`WALLET_NOT_INSTALLED`, `WALLET_USER_REJECTED`, `WALLET_TIMEOUT`,
`WALLET_MALFORMED_RESPONSE`, `WALLET_NETWORK_MISMATCH`, `WALLET_ERROR`,
`ORDINALS_ADDRESS_MISSING`, `ORDINALS_KEY_INVALID`, `ORDINALS_KEY_MISMATCH`,
`INVALID_DESTINATION`, `INVALID_FEE_RATE`, `INVALID_OUTPOINT`, `INVALID_POSTAGE`,
`DUPLICATE_INPUT`, `EMPTY_BATCH`, `FEE_EXCEEDS_VALUE`, `DUST_OUTPUT`,
`ACCOUNTING_MISMATCH`, `INPUT_INDEX_MISMATCH`, `WEIGHT_LIMIT_EXCEEDED`,
`PSBT_MALFORMED`, `VERIFICATION_FAILED`, `UNEXPECTED`.

If a refusal appears with **no** code, or with a code outside that list, record it
— it means an unhandled path was reached. If the code is in the list, it is a
refusal the application made on purpose, and what matters is whether the refusal
was correct.

---

## M1 — Wallet connection

**Closes:** B5 (live wallet approval), J2 (connect and see the wallet)
**Chain:** Signet or Testnet. **Real funds at risk:** none. **Funded wallet:** not required.

**Preconditions:** Xverse installed and unlocked, set to the same network the
console is set to. The console is on `/app` with a clean reload.

**Steps**

1. In step 01, leave the **Network** selector on `Signet` (or `Testnet`).
2. Press **Connect Xverse**.
3. Approve the connection in the Xverse popup. The request carries
   `message: "Connect to inspect inscription UTXOs and build a BTC sweep."` and asks
   for the **Ordinals** and **Payment** addresses.
4. Wait for the console to return. Read step 01's summary block.

**Expected result**

- `WALLET` reads `Xverse · <network>` and the chip reads **Connected**.
- **Ordinals (bc1p / tb1p)** shows the wallet's Taproot address, and **Payment**
  shows the payment address. Both are readable, not truncated into ambiguity.
- **Wallet reports network** matches the selected network exactly.
- The status line reads `Connected to … on … Address and public key agree.`
- No error banner appears. `src/lib/xverse.ts` calls `deriveOrdinalTaproot` before
  returning, so reaching this state means the reported public key really is the
  BIP86 output of the displayed address — a wallet that returned a mismatched pair
  would have stopped with `[ORDINALS_KEY_MISMATCH]` instead.

**Failure to record:** a wallet whose Ordinals address is not `p2tr` must be
refused with `[ORDINALS_ADDRESS_MISSING]` and an explanation naming the returned
address type. Record that as a PASS for the refusal, not a FAIL.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator connected Xverse at commit `c9ef05b` on 2026-10-08 in `plan` mode and reported the connection state correct. **Outstanding before this can be a formal PASS:** the chain used, the browser and Xverse versions, a redacted screenshot of step 01, and the exact status-line text. Gates **B5** and **J2** stay **NOT VERIFIED** until those are recorded — a report is not a checkable artifact on its own |

---

## M2 — Wallet disconnect and reconnect

**Closes:** H9 (disconnect/reconnect), C5 (post-scan state handling)
**Chain:** Signet or Testnet. **Real funds at risk:** none. **Funded wallet:** not required.

**Preconditions:** M1 completed in the same session, so a wallet is connected.

**Steps**

1. Press **Disconnect**.
2. Observe the console state.
3. Press the connect button and approve in Xverse. Note the label: it reads
   `Reconnect Xverse` only while a wallet is still connected, and `Connect Xverse`
   once you have disconnected (`Reclaimer.tsx` chooses the label from the wallet
   state). After step 1 it therefore reads `Connect Xverse` — record whichever you
   actually saw.
4. Now press **Scan all inscriptions**, then **Disconnect while a scan result is on
   screen**. A wallet with no inscription UTXOs still produces a scan *result* (zero
   inscriptions) and still exercises this path; record the scan's numbers.
5. Connect again and start a fresh scan.

**Expected result**

- After **Disconnect**: `WALLET` reads `Disconnected`, the status line reads
  `Disconnected.`, and the address rows are gone.
- Reconnecting clears prior state rather than carrying it over: scan, selection,
  sweep, verification reports, broadcast outcomes and confirmation statuses are all
  reset (`onConnect` clears them explicitly). A stale "verified" badge from the
  previous wallet must not survive.
- **Disconnecting with a scan on screen** clears the scan and the sweep too, so no
  transaction built from the previous session can still be signed. A signature
  request is bound to the address the wallet returns, so a leftover sweep cannot
  be signed by a different wallet — but record what the screen actually showed.
  `onDisconnect` clears `wallet`, the input script, the scan, the selection, the
  sweep and the Mainnet acknowledgement; it does not clear the signing phrase, but
  the phrase field is not rendered once the sweep is gone.
- After **reconnecting** (not merely disconnecting), `onConnect` clears the
  destructive acknowledgement, the Mainnet acknowledgement and the signing phrase,
  so the phrase field is empty again and the acknowledgement is unchecked. The
  phrase field only appears once a sweep exists, so to see it at all you need to
  build a sweep first (M5/M7 territory) — otherwise record that the field was not
  rendered rather than recording it as empty.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator pressed **Disconnect**, observed the console, and reconnected Xverse at commit `c9ef05b` on 2026-10-08 in `plan` mode, reporting the disconnect/reconnect behaviour correct. **Outstanding before this can be a formal PASS:** the chain used, the browser and Xverse versions, a redacted screenshot of the disconnected and the reconnected states, the exact status-line text, and the scan numbers from step 4 if that step was run. Gate **H9** stays **NOT VERIFIED** until those are recorded — C5's **PASS** rests on the component behaviour and `tests/wallet.test.ts`, not on this run |

---

## M3 — Network switching

**Closes:** H9 (network switches), B5
**Chain:** two networks required (for example Signet and Testnet, or Testnet and Mainnet). **Real funds at risk:** none, provided you do not sign on Mainnet.

**Preconditions:** Xverse can be switched between two Bitcoin networks.

**Steps**

1. With Xverse on **Signet**, set the console's **Network** selector to **Testnet**
   and press **Connect Xverse**.
2. Record the refusal.
3. Switch Xverse itself to **Testnet**, then connect again.
4. Now set the console back to **Signet** while Xverse stays on Testnet, and
   connect.
5. Switch Xverse back and confirm the console reconnects cleanly.

**Expected result**

- Step 1 must be **refused with `[WALLET_NETWORK_MISMATCH]`**, naming the network
  Xverse is on and the network the console is set to, and stating that nothing will
  be built on the wrong chain. The console must not proceed to step 02.
- A network mismatch must never be silently accepted and must never produce a
  transaction.
- After switching Xverse, connecting succeeds and **Wallet reports network** matches.
- If Mainnet is disabled in the build, selecting `Mainnet` shows
  `Mainnet (locked in code)` in the selector and refuses with `[MAINNET_DISABLED]`
  rather than attempting anything.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator switched the console and Xverse between networks at commit `c9ef05b` on 2026-10-08 in `plan` mode and reported the network handling correct. **Outstanding before this can be a formal PASS:** which two networks were used, the browser and Xverse versions, a redacted screenshot of the mismatch refusal, and the exact refusal text (the `[WALLET_NETWORK_MISMATCH]` message). Gates **H9** and **B5** stay **NOT VERIFIED** until those are recorded |

---

## M4 — Full inscription scanning

**Closes:** H10 (pagination against a live provider), J2 (see gross BTC, fees, net output)
**Chain:** Signet or Testnet preferred. **Real funds at risk:** none — scanning never signs. **Funded wallet:** **yes**, with inscription-bearing UTXOs.

**Preconditions:** M1 completed. The wallet holds inscription UTXOs. For the
pagination part of this case the wallet should hold **more inscriptions than the
provider's page size**, so more than one request is required.

**Steps**

1. Press **Scan all inscriptions** and let it finish. Do not navigate away.
2. Read the step 02 statistics block in full.
3. Compare **Indexer reported** with **Inscriptions retrieved**.
4. If the console reports any quarantined rows, open *N row(s) excluded as
   unusable* and read the reasons.
5. Press **Scan all inscriptions** again and confirm the numbers are stable.
6. Optionally, watch the browser's network panel and confirm the request count
   matches **Pages read**.

**Expected result**

- **Pages read** is greater than 1 for a wallet larger than one page, and
  **Inscriptions retrieved** reaches **Indexer reported**.
- **Unique UTXOs** is less than or equal to the inscription count, because several
  inscriptions can share one output.
- **Total sats** is the gross input value, and the console must label it as such —
  it is not "recovered" bitcoin and must never be presented as the net result.
- A scan that cannot reach the reported total must end with
  `Scan INCOMPLETE — retrieved X of Y` and `[SCAN_INCOMPLETE]` on any attempt to
  sweep. It must **not** present a partial inventory as complete.
- Running the scan twice must produce the same UTXO count and the same total; a
  count that drifts between runs is a finding.
- **Rows with no address** must be reported if non-zero, with the explanatory note,
  rather than folded into a claim that every row was confirmed as the wallet's.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator ran the scan at commit `c9ef05b` on 2026-10-08 in `plan` mode and reported it working. **No scan figures were recorded**, so this row claims nothing about them. **Outstanding before this can be a formal PASS:** the step 02 statistics block — **Indexer reported**, **Inscriptions retrieved**, **Unique UTXOs**, **Pages read**, **Total sats** and **Rows with no address** — the rescan's numbers, the chain, the browser and Xverse versions, and a redacted screenshot. Whether the wallet held any inscription UTXOs at all is also unanswered, and if it did not, this observation covers the empty-inventory path only. Gate **H10** (pagination against a live provider) therefore stays **NOT VERIFIED** — a `Pages read` above 1 was never observed, so crossing the provider's page size is unexercised — and **J2** stays **NOT VERIFIED** |

---

## M5 — Large PSBT payload handling

**Closes:** B6 (the provider's real payload limit — the release blocker for the largest wallets)
**Chain:** Signet or Testnet strongly preferred. **Real funds at risk:** only if you sign on Mainnet. **Funded wallet:** **yes**, ideally with hundreds to thousands of inscription UTXOs.

**Preconditions:** M4 completed, so a whole-wallet scan is on screen. A
destination address valid on the same network is prepared. **This is the only case
that can close B6, and it cannot be closed by a synthetic run.**

**Steps**

1. Acknowledge the destructive warning, then **Select all N UTXOs**.
2. Enter the destination address and a fee rate of `1`.
3. Press **Sweep all** and read step 05's headline: either
   `N UTXOs → 1 Bitcoin transaction → 1 destination` or the multi-batch form.
4. Record the pre-sign review figures: input count, total input sats, destination
   output sats, mining fee, fee as a percentage, vsize and weight.
5. Press **Sign + verify** for batch 1.
6. **Watch what Xverse does.** This is the observation B6 exists for: does it
   present the full input list, does it accept the payload, does it refuse, does it
   time out, or does the extension become unresponsive?
7. If Xverse refuses for a size reason, record the exact wording, then observe the
   console's automatic re-plan: it must halve the largest batch and report
   `Xverse rejected the N-input transaction as too large. Re-planned the same N
   UTXOs into M transactions of up to K inputs each … Nothing was signed.`
8. Sign and verify the remaining batches one at a time.

**Expected result**

- With Xverse's approval, the signed PSBT is verified locally per batch and the
  final review block appears with input count, input sats, output sats, mining fee,
  fee percentage, vsize, destination and txid.
- If Xverse refuses the payload, the console re-plans rather than failing, and the
  re-plan preserves the total: the sum of the batches must cover **exactly** the
  selected UTXO set, with no input lost and none signed twice.
- Every batch must verify on its own. A `[VERIFICATION_FAILED]` on any batch means
  **do not broadcast** and is a critical finding.
- Nothing is signed without the `SPEND AS BTC` phrase and, on Mainnet, the separate
  Mainnet acknowledgement.

**Record explicitly, for gate B6:** the largest number of inputs Xverse actually
accepted in one signing request, the largest number it refused, and the exact
refusal text. That single number is the evidence B6 needs, and it belongs in
[`PERFORMANCE.md`](PERFORMANCE.md) beside the synthetic table — labelled as the
real-wallet figure, separate from the synthetic one.

| Largest batch accepted by Xverse | Largest refused, and the exact refusal text | Result (PASS/FAIL/BLOCKED) | Evidence |
| --- | --- | --- | --- |
| **Not recorded** | **Not recorded** | **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator reports the large-payload case passed at commit `c9ef05b` on 2026-10-08, but **no input count was supplied for either column**. Gate **B6** *is* the requirement that a real wallet accepted a stated number of inputs, so a report without the number cannot close it: **B6 stays NOT VERIFIED**. When the count arrives it belongs in [`PERFORMANCE.md`](PERFORMANCE.md) beside the synthetic table, labelled as the real-wallet figure |

---

## M6 — User cancellation

**Closes:** B5 (the wallet really does control the outcome), and the guarantee that a cancelled request has no side effect
**Chain:** Signet or Testnet. **Real funds at risk:** none. **Funded wallet:** **yes** for the cancellation-of-signing step.

**Preconditions:** M4 completed and a sweep is built in step 05.

**Steps**

1. Press **Sign + verify**, then **reject the request inside Xverse**.
2. Record the console's response and the resulting state.
3. Confirm that no transaction review block appeared, that no txid is shown, and
   that the sweep is still present and still signable.
4. Press **Sign + verify** again and approve this time; confirm the flow recovers.
5. Separately, disconnect in step 01 and then attempt the scan: it must be
   unavailable while no wallet is connected.
6. Separately, press **Connect Xverse** and dismiss the Xverse popup without
   approving. Wait, and record what happens.

**Expected result**

- A rejection surfaces as `[WALLET_USER_REJECTED]` with a message stating that
  nothing was signed and nothing was broadcast (`src/lib/xverse.ts` maps
  `RpcErrorCode.USER_REJECTION` this way).
- **No** verification report and **no** txid are produced by a cancelled request.
- Retrying after a cancellation works; the console is not left in a broken state.
- A popup dismissed without answering is a **timeout**, not a rejection: the
  interactive timeout is 10 minutes for connect and signing (`INTERACTIVE_TIMEOUT_MS`),
  after which the console must report `[WALLET_TIMEOUT]`. Record how long it
  actually took and whether the console stayed responsive while waiting.
- At no point does a cancellation produce a transaction, a broadcast or a retry.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator reports the cancellation case passed at commit `c9ef05b` on 2026-10-08, including the signing-cancellation steps (so a sweep was built and a funded wallet was in use). **Outstanding before this can be a formal PASS:** the exact bracketed code for each refusal (`[WALLET_USER_REJECTED]` for a rejection, `[WALLET_TIMEOUT]` for a popup left unanswered, and what a dismissed connect popup actually produced), the state observed after the rejection, the chain, browser and Xverse versions, and a redacted screenshot. Gate **B5** stays **NOT VERIFIED** |

---

## M7 — Signing and signature verification

**Closes:** B5 (live approval verified locally), J3 (the user approves and the fee is zero)
**Chain:** Signet or Testnet first. **Real funds at risk:** **only if run on Mainnet.** **Funded wallet:** **yes**.

**Preconditions:** M4 completed; a sweep built; destination validated with
**Validate destination only**; broadcasting enabled for the chain if this case is
extended into M9.

**Steps**

1. Type `SPEND AS BTC` into the **Signing acknowledgement phrase** field. Confirm
   that **Sign + verify** is disabled until the phrase matches exactly.
2. On Mainnet, also tick the **MAINNET — REAL BTC** acknowledgement and confirm
   that signing stays disabled until it is ticked.
3. Press **Sign + verify** and approve in Xverse. Confirm that Xverse's approval
   screen does **not** offer to broadcast — the request is sent with
   `broadcast: false`.
4. Read the verification verdict and the full checklist.
5. Open the batch's check list and read every line.
6. Press **Download verified .hex** and confirm a file is saved.

**Expected result**

- The verdict reads `Verified locally: N/N signatures valid, fee … sats, … vB,
  txid …`, and the checklist reports each check passing.
- The final review block shows **input count, input sats, output sats, mining fee,
  fee as % of input, vsize, destination and txid**, all derived from the serialized
  PSBT rather than from the object that built it.
- The destination shown equals the address you entered, exactly.
- `input sats − mining fee == output sats`. If that arithmetic is off by one sat,
  it is a critical finding.
- No platform fee line exists anywhere, because there is no platform fee.
- On a multi-batch sweep, each batch verifies independently and the batches
  together cover exactly the selected set with nothing signed twice.
- The note appears stating that the signed transaction exists only in this tab and
  that refreshing discards it.

**Independent cross-check (do this, do not skip it):** take the exported `.hex` and
decode it with a tool that is not this application — for example
`bitcoin-cli decoderawtransaction` against your own node, or an independent
decoder. Confirm the input count, output count, destination script and txid match
what the console displayed. The app's own verifier is independent of its builder,
but this is the only check that is independent of both.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator reports signing and verification passed at commit `c9ef05b` on 2026-10-08. **Outstanding before this can be a formal PASS:** the exact `Verified locally: N/N signatures valid, fee … sats, … vB, txid …` line, the input/output sats it reported, whether the independent decode cross-check was performed and what it showed, the chain, browser and Xverse versions, and a redacted screenshot. Gates **B5** and **J3** stay **NOT VERIFIED** — and note that this case deliberately does not broadcast, so it cannot evidence on-chain confirmation either |

---

## M8 — Import and export recovery

**Closes:** C8 (recovery after a refresh), and re-confirms C6/C7 against the live UI
**Chain:** Signet or Testnet, unless you have a genuinely disposable Mainnet transaction. **Real funds at risk:** none if you stop before broadcasting. **Funded wallet:** **yes**.

**Preconditions:** M7 completed, so a verified transaction and its `.hex` file exist.

**Steps**

1. **Simulate the interruption.** With the verified transaction on screen, press the
   browser's reload button. Record exactly what happens to the signed transaction.
2. After the reload, reconnect the wallet and locate the **Recover a saved
   transaction** panel.
3. Press **Load .hex file** and choose the file saved in M7. Alternatively, paste
   the hex into the textarea and press **Inspect transaction**.
4. Read the inspection output.
5. Confirm that **Broadcast** is disabled, then find what it takes to enable it:
   the authorization checkbox must be re-ticked for this exact txid, and the
   `SPEND AS BTC` phrase must be typed again.
6. If you intend to test the broadcast path, do it in M9 rather than here.
7. Repeat step 3 with a **deliberately truncated or altered** hex string and record
   the refusal.

**Expected result**

- **After the reload**, the signed transaction is gone and the console does not
  pretend otherwise. The sweep must be rebuilt and signed again. This is the
  documented limitation of gate C8 and it is expected behaviour — record it as a
  PASS for "behaviour matches the documented limitation", and note in the gate that
  automatic recovery remains unsupported.
- The console must have shown, **before** the reload, the note telling you to save
  the verified bytes for exactly this reason.
- On import: the status reads `Inspected txid …: N input(s), M output(s), … vB.
  Nothing has been signed or broadcast.`
- The panel states plainly what it **cannot** verify. A raw transaction carries no
  input values, so the fee and input total must be reported as unknown rather than
  invented.
- **Importing must not inherit approval.** The checkbox starts empty on every load,
  including a file that was approved in an earlier session.
- A truncated or altered hex must be refused with a local check failing and
  broadcasting blocked — never accepted with a warning.
- Nothing is broadcast by the act of importing.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator reports the import/export recovery case passed at commit `c9ef05b` on 2026-10-08. **Outstanding before this can be a formal PASS:** what the reload actually did to the signed transaction, the import status line (`Inspected txid …: N input(s), M output(s), … vB. Nothing has been signed or broadcast.`), the truncated-hex refusal text, and a redacted screenshot. **Gate C8 does not follow from this case and stays NOT VERIFIED:** C8 requires a signed transaction to survive a refresh with *no user action*, which is deliberately not implemented. A successful manual recovery is the documented alternative to C8, not proof of it |

---

## M9 — Broadcast status and confirmation tracking

**Closes:** J3 (explicit broadcast, zero platform fee), J4 (verify the txid and its confirmation), and C9 if run on Signet/Testnet
**Chain:** Signet or Testnet to begin. Mainnet only by your explicit decision, and only after every other case has passed. **Real funds at risk:** **yes, on Mainnet.** **Funded wallet:** **yes**.

**Preconditions:** M7 completed with broadcasting enabled for the chain under
test. This is the only case that sends anything to a node.

**Steps**

1. In the final review block, tick the per-transaction authorization checkbox,
   which names the exact txid. Confirm the **Broadcast** button is disabled until
   the box matches the current txid.
2. Press **Broadcast transaction** (or **Broadcast Mainnet Transaction**).
3. Read the outcome banner and record the endpoint that accepted it.
4. Press **Check confirmation**.
5. Wait for at least one confirmation, then press **Check confirmation** again.
6. Open the explorer link and confirm it resolves to the same txid.
7. Force the ambiguous path: press **Broadcast** a second time if the button is
   still available, or submit the same `.hex` through the import panel, and record
   whether the app can be made to submit a duplicate.
8. On Signet/Testnet, deliberately attempt a broadcast while the broadcast flag is
   **off** and record the refusal.

**Expected result**

- The outcome reads `Broadcast accepted by <endpoint>. txid <txid>.` or, for a
  transaction the network already has, `Already known: the network already has txid
  <txid> (<endpoint>)` — and an already-known response is reported as success, not
  as a failure.
- The returned txid must equal the locally verified txid. A mismatch is a critical
  finding: `[BROADCAST_TXID_MISMATCH]`, nothing further submitted.
- **Check confirmation** reports either in-mempool or confirmed, with the block
  height when known. It must never report a fabricated confirmation: an endpoint
  that returns HTTP 200 without a boolean `confirmed` is treated as inconclusive
  and the next endpoint is asked (review finding F6).
- An accepted transaction is memoized per txid per session, so a second press of
  **Broadcast**, or the same bytes through the import panel, must not submit again.
- With broadcasting disabled, the button is disabled and the code refuses with
  `[BROADCAST_DISABLED]` regardless of UI state, with a hint naming the flag to set.
- A rejected submission is reported verbatim and **never retried**, and the app
  never signs a replacement.

| Result (PASS/FAIL/BLOCKED) | Evidence (txid, screenshot, console text) |
| --- | --- |
| **PROVISIONAL PASS** — operator-reported, not yet formally verified | Operator reports broadcast and confirmation tracking passed at commit `c9ef05b` on 2026-10-08. **Outstanding before this can be a formal PASS, and the item that matters most on this whole page: the txid and the network it was broadcast on.** Also outstanding: the outcome banner wording, the endpoint that accepted it, the confirmation height, whether the duplicate-submission attempt was actually made and refused, the chain, browser and Xverse versions, and a redacted screenshot. Gate **J3** stays **NOT VERIFIED**; **C9** stays **NOT VERIFIED** unless the chain was Signet or Testnet *and* the txid is supplied — an operator-reported Mainnet confirmation is not independent proof of anything on chain |

---

## Results summary

Filled in as cases are run. A row whose right-hand column says **No** is still
unverified, and the gate it belongs to stays **NOT VERIFIED**.

| Case | Gates | Operator-reported | Formally verified |
| --- | --- | --- | --- |
| M1 Wallet connection | B5, J2 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — chain, versions, screenshot and status line outstanding |
| M2 Disconnect / reconnect | H9, C5 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — the same, plus the exact status line and scan numbers |
| M3 Network switching | H9, B5 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — the two networks used and the exact refusal text outstanding |
| M4 Full inscription scanning | H10, J2 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — the scan statistics and rescan figures outstanding |
| M5 Large PSBT payload handling | B6 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — the accepted input count was never recorded |
| M6 User cancellation | B5 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — the exact refusal codes outstanding |
| M7 Signing and verification | B5, J3 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — the verification verdict outstanding |
| M8 Import / export recovery | C8 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — and C8 is not addressed by this case at all |
| M9 Broadcast and confirmation | J3, J4, C9 | PROVISIONAL PASS — 2026-10-08, `c9ef05b` | **No** — no txid and no network supplied |

**Operator-reported: 9/9. Formally verified: 0/9.** Nine reports that a human saw
something work are real information, and they are recorded here rather than
discarded — but the two columns are not the same claim, and only the right-hand one
moves a gate.

## What to do with the results

- Move a gate to **PASS** in [`RELEASE_GATES.md`](RELEASE_GATES.md) only when its
  case is **formally verified** — a checkable artifact, not a report. A gate moved
  on an operator report alone is worth nothing and is worse than an honest
  `NOT VERIFIED`, because it retires a question that is still open.
- An operator report still counts for something, and it is recorded as
  `PROVISIONAL PASS` rather than omitted. It tells the next reader where to look
  first; it does not tell them the answer.
- Record a `FAIL` as a `FAIL`. A failing case is the most valuable output this
  document can produce, and it should become a regression test in the suite before
  it is fixed.
- If a case is `BLOCKED` — no funded wallet, no Signet UTXO, no provider — leave the
  gate `NOT VERIFIED` and write down what was blocking. Do not substitute a
  different test and call the gate closed.
- If anything in this suite reveals a way to build, sign, verify or broadcast
  without the gates described above, stop and report it privately under
  [`SECURITY.md`](../SECURITY.md) rather than in a public issue.
