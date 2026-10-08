# Public beta readiness

This document covers what must be true before Sat Reclaimer is announced, and the
one architectural weakness the redesign surfaced. It is deliberately blunt: a
real-money Bitcoin tool loses trust the first time it overstates itself.

> [`docs/RELEASE_GATES.md`](RELEASE_GATES.md) is the single source of truth for
> what is proven and what is not. This document is the narrative behind the open
> items; that one carries the PASS / FAIL / NOT VERIFIED status and the evidence.
> The **repository** is public under MIT. The **website** is not deployed for
> public users, and unrestricted Mainnet reclaim stays blocked while gates A11
> (external audit), B6 (provider payload limit) and E8 (security contact) are open.

## Open issue — a signed transaction lives only in browser memory

**What happens.** After Xverse signs a batch, the signed PSBT is verified and the
finalized raw transaction is held in React state (`Reclaimer.tsx` →
`reports[index]`). Nothing is written to `localStorage`, IndexedDB, the URL, or a
server. If the tab is refreshed, closed, or crashes between "verify" and
"broadcast", the signed transaction is gone and the user must sign again.

**Why it was built that way.** The alternative — persisting signed transactions or
wallet inventory to browser storage — creates a durable artefact of a
near-broadcast transaction sitting on disk in a shared profile, and it invites
exactly the kind of "resume automatically" behaviour this project forbids. Losing
a signature is annoying; silently reintroducing a signed transaction from storage
and submitting it later is worse.

**What is not at risk.** Only convenience. A signed transaction that is never
broadcast does not exist on the network: no node has seen it, the inputs remain
unspent and under the user's control, and re-signing produces an equivalent
transaction. There is no scenario in which closing the tab loses bitcoin.

**Mitigation shipped in this redesign.** Once a batch verifies, the console offers
*Download verified .hex*, which saves the finalized raw transaction as a plain
`.hex` file. A raw transaction is the exact byte sequence that would be broadcast
to every node, so it contains no key material and nothing secret; it can be
re-submitted later through any independent broadcast tool. The export is a single
user-initiated click, is not automatic, and writes nothing outside the user's own
downloads folder.

**Proposed (not implemented) persistent recovery design.** If beta testing shows
people routinely lose signatures — most likely with a 20+ minute wallet approval on
a very large sweep — the safe version is:

1. Store only the **finalized raw transaction** and its **txid**, never the wallet
   PSBT, never addresses, never an xpub.
2. Gate the write behind an explicit opt-in shown on the same screen as the
   download button ("keep this signed transaction in this browser until it is
   broadcast"), default off.
3. Encrypt at rest with a key derived from a user-supplied passphrase, so a shared
   browser profile alone is not sufficient to read it.
4. Expire the record automatically after a short window (for example 24 hours)
   and delete it on successful broadcast, on disconnect, and on a manual "forget"
   control.
5. On restore, re-run the full standalone verification — decode, re-derive the
   txid, re-check inputs, outputs, fee and conservation — against the stored
   bytes, and show the same authorization checkbox. Never resume automatically and
   never submit without a fresh explicit authorization.
6. Never store anything while the user is offline from the app's own point of view,
   and never include stored data in analytics.

This is a design, not a commitment. It needs its own security review before it is
built.

## Verified in this pass

- Wallet integration is unchanged: `src/lib/xverse.ts` is byte-identical, and the
  console still calls `connectXverse`, `scanOrdinals`, `signPsbt` (always
  `broadcast: false`) and `disconnectXverse` exactly as before.
- Mainnet opt-in is unchanged: `NEXT_PUBLIC_ENABLE_MAINNET` still gates the
  Mainnet workflow, and `NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST` is still a second,
  independent gate. Neither was touched by the redesign.
- Separate signing and broadcasting: still two buttons, two code paths, and a
  per-txid authorization checkbox between them.
- No analytics, no telemetry, no third-party scripts. Wallet inventory, addresses
  and transaction data never leave the browser except to the wallet itself, the
  ordinals indexer, and the public broadcast endpoints the user explicitly
  authorizes.
- No page in this app has a field for a seed phrase or private key, and no code
  path can obtain one.
- The landing page and demo cannot reach the Bitcoin engine: `Demo.tsx` imports
  nothing from `src/lib`, holds no wallet handle and has no network client. Visual
  QA recorded zero broadcasts.

## Launch blockers

Ordered by what would actually hurt a user.

| # | Blocker | Why it matters | Where |
| --- | --- | --- | --- |
| 1 | **Live wallet behaviour at scale is still unexercised from this repository.** | A real 1,079-input sweep **is** confirmed on chain (block 970454), which proves the flow end to end from the operator's side. What no in-repo test can prove is what Xverse's own request-size limit will accept for a multi-thousand-input sweep — local signing with a deterministic key does not exercise the provider. Recorded as gate B5/B6. | [`docs/RELEASE_GATES.md`](RELEASE_GATES.md), [`docs/PERFORMANCE.md`](PERFORMANCE.md) |
| 2 | **`NEXT_PUBLIC_SITE_URL` is unset.** | Canonical URLs, `og:url` and `sitemap.xml` fall back to `http://localhost:3000`. Social cards and search results would point at localhost. | `app/layout.tsx`, `app/sitemap.ts`, `app/robots.ts` |
| 3 | **No independent security review.** | The landing page states this plainly under "Not audited"; it must stay stated until an audit exists. An internal review exists and is worth reading, but it is not an external one. | `SECURITY.md`, [`docs/SECURITY_REVIEW.md`](SECURITY_REVIEW.md), Trust section |
| 4 | **Broadcast endpoints are third-party public nodes.** | mempool.space and blockstream.info see the raw transaction before/alongside the network. Behaviour under rate limiting and outage is handled but untested against the live services. | `src/lib/broadcast.ts` |
| 5 | **Signet/Testnet proof of concept is still not demonstrated.** | No inscription-bearing Signet UTXO exists to sweep, so the non-Mainnet path has never run against a real chain. | `CLAUDE.md`, milestone M1 |
| 6 | **Supported-wallet coverage is Xverse only.** | Users on other wallets get a clear message, but there is no second signer to fall back to. | `src/lib/xverse.ts` |
| 7 | **Mainnet flags are enabled in `.env.local` on this machine.** | Correct for the operator's own testing, wrong for anything public. A public deployment must ship with all three flags `false` unless deliberately enabled. This was verified to work: a build with the flags forced to `false` in the environment overrides `.env.local`, and the prerendered console then reads `Mainnet (locked in code)` with no Mainnet banner anywhere. | `.env.example`, CI job `verify` |
| 8 | **No security contact exists.** | `SECURITY.md` documents the intended process and names the missing contact as a release blocker rather than inventing an address. A public project needs a channel that is not a public issue. | `SECURITY.md`, gate E8 |

## Do not do these

- Do not deploy a publicly reachable Mainnet-broadcast-enabled site while gates
  A11, B6 and E8 are open. Publishing the repository is exactly what we want;
  publishing an unrestricted real-BTC interface is not.
- Do not describe the product as audited, certified, verified, or risk-free.
- Do not claim a previously broadcast transaction confirmed without checking its
  on-chain status on independent nodes.
- Do not present gross input sats as recovered bitcoin. Net output is
  `inputs − mining fee`, and the fee is re-derived from the finalized transaction.
- Do not add persistence of wallet data, PSBTs, or signed transactions without the
  review described above.
