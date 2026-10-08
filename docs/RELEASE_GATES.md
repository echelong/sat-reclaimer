# Release gates

Measurable release checklist for SAT//RECLAIMER. Each gate is **PASS**, **FAIL**
or **NOT VERIFIED**, with the evidence that produced that status. This document
is the single source of truth for launch readiness; `README.md`,
`docs/PUBLIC_BETA.md` and the website link here rather than restating it.

Scope of evidence is stated per gate. **An internal code review is not an
independent external security audit.** Where only internal review exists, the
gate is **NOT VERIFIED** and unrestricted public Mainnet launch stays blocked.

Legend: **PASS** = demonstrated in this repository with reproducible evidence ·
**FAIL** = a requirement is unmet and must be fixed · **NOT VERIFIED** = not
demonstrated by any evidence available here (often because it needs a live wallet,
a real deployment, or a third party).

Date of record: 2026-10-08. Repo HEAD audited: see `docs/MAINNET_ACCEPTANCE.md`
and the final release report.

---

## A — Bitcoin protocol safety

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Inputs deduplicated by `txid:vout`; duplicate inscription rows cannot inflate a sweep | **PASS** | `uniqueByOutpoint` in `src/lib/ordinals.ts`; `tests/ordinals.test.ts`; `tests/security-regressions.test.ts` |
| A2 | Conservation `Σinputs = Σoutputs + fee` re-derived from the serialized PSBT, per batch | **PASS** | `src/lib/psbt.ts` (`measureSweep`), `src/lib/verify.ts`; asserted per size in `tests/large-wallet.test.ts` |
| A3 | Every transaction decoded and invariant-checked independently of the code that built it | **PASS** | `src/lib/verify.ts` shares no builder state; `tests/verify.test.ts` |
| A4 | Exact vsize/weight/fee from the measured serialized artifact, never a fixed per-input rule | **PASS** | Confirmed 1,079-input Mainnet sweep matched the analytic weight to the byte at exactly 1 sat/vB (`docs/MAINNET_ACCEPTANCE.md`) |
| A5 | Dust / relay thresholds enforced before building | **PASS** | `dustThresholdSats()` in `src/lib/bitcoin.ts`, `DUST_OUTPUT` guard in `src/lib/psbt.ts`. Honest note: the library today collapses sub-dust remainders, so the guard is currently unreachable — recorded rather than counted as exercised |
| A6 | Fee is never below `feeForWeight(measuredWeight, rate)` | **PASS** | Assertion in `src/lib/psbt.ts`; delta measured 0 across 16 size×rate combinations |
| A7 | Finalization requires a non-empty witness on every input | **PASS** | `assertFinalizedTransaction()` in `src/lib/broadcast.ts` |
| A8 | Signing and broadcast are separate; nothing broadcasts automatically; no replacement is signed; an ambiguous response is never resubmitted | **PASS** | `src/lib/xverse.ts` (`broadcast:false`), `src/lib/broadcast.ts`; `tests/broadcast.test.ts` |
| A9 | BIP341 sighash recomputed locally and asserted equal to the library bit-for-bit | **PASS** | `src/lib/sighash.ts`; `tests/sighash.test.ts` |
| A10 | A real Mainnet sweep is confirmed on chain with verified accounting | **PASS** | `docs/MAINNET_ACCEPTANCE.md`: 1,079 inputs, one output, 62,087 vB, 62,087 sat fee, block 970454 |
| A11 | Independent **external** Bitcoin security audit | **NOT VERIFIED** | No third-party audit performed. Internal review is `docs/SECURITY_REVIEW.md`. **Blocks unrestricted public Mainnet launch.** |

## B — Wallet compatibility

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Wallet client typed against the installed provider API, with timeouts and error mapping | **PASS** | `src/lib/xverse.ts` against `sats-connect@4.2.1` declarations; `tests/wallet.test.ts` |
| B2 | Ordinals address proven to be the BIP86 output of the reported public key | **PASS** | `src/lib/bitcoin.ts`; `tests/bitcoin.test.ts` |
| B3 | Reported wallet network reconciled against the requested network | **PASS** | `src/lib/xverse.ts` (mismatch stops the flow) |
| B4 | Only Xverse / Sats Connect is claimed as supported | **PASS** | Stated in README, `/privacy`, `/open-source`, `docs/RISK.md` |
| B5 | A live wallet approval exercised end-to-end | **NOT VERIFIED** | This environment cannot drive the browser extension. The only real-wallet data point is the confirmed Mainnet transaction (A10), whose wallet-side approval was observed by the operator, not re-observed here |
| B6 | The provider's real PSBT payload limit is proven | **NOT VERIFIED** | Synthetic signing does not exercise the provider request-size limit. Largest real-wallet-approved count recorded separately in `docs/PERFORMANCE.md`. **Release blocker for the largest wallets.** |

## C — Transaction reliability

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Multi-batch sweeps sign, verify and finalize each batch on its own | **PASS** | `tests/large-wallet.test.ts` (2,000 → 2, 5,000 → 3, 10,000 → 6 batches) |
| C2 | Interrupted batches cannot produce a duplicate transaction | **PASS** | Exact-partition invariants + per-`txid` broadcast authorization; `tests/security-regressions.test.ts` |
| C3 | Imported raw transactions never inherit prior approval and never auto-broadcast | **PASS** | `src/lib/imported-transaction.ts` + `src/components/console/ImportTransaction.tsx`; `tests/imported-transaction.test.ts` |
| C4 | Unverifiable fields of an imported transaction are reported, not assumed | **PASS** | `feeSats`/`inputSats` returned `null` with a 4-item `unverifiable` list |
| C5 | Post-scan wallet/network switch, disconnect and reconnect handled | **PASS** | `src/components/Reclaimer.tsx`; covered by component behaviour and `tests/wallet.test.ts` |
| C6 | A signed transaction is recoverable after a page refresh | **PASS (partial)** | *Download verified .hex* exists; automatic persistent recovery is documented but not implemented (`docs/PUBLIC_BETA.md`) |
| C7 | Signet/Testnet end-to-end sweep | **NOT VERIFIED** | No inscription-bearing Signet UTXO exists to spend; cannot be demonstrated in this environment |

## D — Large-wallet acceptance

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| D1 | 1 / 100 / 500 / 1,083 / 2,000 / 5,000 / 10,000 UTXOs planned, batched, measured | **PASS** | `docs/PERFORMANCE.md` (measured table), `tests/large-wallet.test.ts` |
| D2 | Sizes ≤ 2,000 also signed and independently verified in-process | **PASS** | Same table; `sign + verify` column |
| D3 | No input lost or duplicated at any size; batches are an exact partition | **PASS** | Per-size invariants asserted in `tests/large-wallet.test.ts` |
| D4 | The largest input count **approved by a real wallet** recorded separately from synthetic results | **PASS** | `docs/PERFORMANCE.md`: 1,079 inputs, evidenced by the confirmed Mainnet transaction |
| D5 | Memory, PSBT size and raw size measured | **PASS** | RSS ~99→203 MB; PSBT/raw totals per size in `docs/PERFORMANCE.md` |
| D6 | Synthetic performance results are not presented as proof of the wallet payload limit | **PASS** | Explicit in `docs/PERFORMANCE.md` |

## E — Security and privacy

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| E1 | Internal security review of the whole lifecycle, findings fixed and regression-locked | **PASS** | `docs/SECURITY_REVIEW.md` (10 findings); `tests/security-regressions.test.ts` (21 tests) |
| E2 | No secret, key material, env file or credential in the working tree **or the full Git history** | **PASS** | `./scripts/scan-secrets.sh` (history) and `--tree` both exit 0; CI job `secrets` runs the history scan |
| E3 | `.env.local` can never be committed; `.gitignore` covers caches, temp files and private outputs | **PASS** | `.gitignore` verified; `.env.local` reported ignored by `git status --ignored` |
| E4 | No analytics, tracker, account or server-side storage of wallet data | **PASS** | No analytics dependency or endpoint in the tree; `/privacy` claim matches request behaviour |
| E5 | Strict CSP and security headers, fail-closed | **PASS** | `next.config.ts`; `script-src`/`style-src 'unsafe-inline'` documented with bounded residual risk |
| E6 | Signing/broadcast separation is structural, not cosmetic | **PASS** | `broadcast:false` always sent; broadcast layer re-derives txid and re-checks network scoping |
| E7 | Independent **external** security audit | **NOT VERIFIED** | Internal review only. **Blocks unrestricted public Mainnet launch.** |
| E8 | A security contact (email/PGP) for vulnerability reports | **FAIL** | No contact exists. `SECURITY.md` documents the intended process and names the missing contact as a release blocker rather than inventing an address |

## F — Open-source publication

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| F1 | LICENSE present and compatible with all bundled source | **PASS** | `LICENSE` (MIT, "Copyright (c) 2026 echelong") with a third-party licence table |
| F2 | Public repository exists under `echelong`, name/description/topics set | **PENDING** | Recorded in the final release report after Phase 5 |
| F3 | Publication audit of the complete history: no secrets, personal data or AI attribution | **PASS** | Both scan modes exit 0; sole author/committer is `Sat Reclaimer <sat-reclaimer@localhost>`; no AI/Co-authored-by trailers in any commit |
| F4 | Never force-push or overwrite existing remote history | **PASS** | No remote configured at audit time; creation path checks existence first |
| F5 | README / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / issue + PR templates | **PASS** | All present in the tree |
| F6 | CI runs lint, typecheck, test, build on the public initial commit | **PENDING** | Workflows authored (`.github/workflows/ci.yml`); first green run on GitHub recorded in the final report |
| F7 | Dependency security review in CI | **PASS** | `audit` job (`pnpm audit --audit-level=high`) |
| F8 | CodeQL / static analysis | **PASS** | `.github/workflows/codeql.yml` (`security-and-quality`, weekly cron) |
| F9 | Dependabot configured for npm + actions | **PASS** | `.github/dependabot.yml` (grouped bitcoin/react/tooling) |
| F10 | Branch protection requiring CI before merge | **NOT VERIFIED** | Requires repository settings that cannot be applied by code; documented in the final report |

## G — Production infrastructure

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| G1 | Production build succeeds | **PASS** | `pnpm build` exit 0; 11 routes prerendered static. Rebuilt with all three product flags `false` and served with `next start` for the browser pass |
| G2 | Deployment model chosen (static vs Node service) | **PASS** | App is static: no server routes. `next.config.ts` sets response headers, which a pure static export cannot, so the deploy target is a Node `next start` web service rather than a static host |
| G3 | Security headers, CSP and cache policy correct in production | **PASS** | `next.config.ts` (`/app` `no-store`; policy pages `s-maxage=3600`) |
| G4 | robots/sitemap rules and canonical/OG metadata | **PASS** | `app/robots.ts`, `app/sitemap.ts`, `NEXT_PUBLIC_SITE_URL` (falls back to localhost until the domain exists) |
| G5 | `NEXT_PUBLIC_*` treated as public config, not an authorization boundary | **PASS** | Enforced in code: broadcast refuses regardless of UI state; server-side is the authority |
| G6 | Rate limiting, where server routes exist | **N/A** | No server routes. Broadcast submissions go directly to public nodes from the browser |
| G7 | Staging deployment protected from public access and indexing | **NOT VERIFIED** | No deployment performed; the production policy in this repo allows indexing and must be narrowed for a staging host |
| G8 | Production feature level reports the true public-launch state | **PASS** | `docs/PUBLIC_BETA.md` states the site is **not** ready for unrestricted public Mainnet reclaim while gates A11/E7/B6 are open |

## H — Browser accessibility and performance

Production build (`all flags false`), served with `next start`, driven in headless
Chromium over the Chrome DevTools Protocol.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| H1 | Production build QA at 1440 / 1280 / 834 / 390 / 320 px | **PASS** | 5 viewports × 6 routes: zero horizontal overflow, layout viewport stays exactly at the device width. Screenshots: [`landing.png`](screenshots/landing.png), [`console.png`](screenshots/console.png), [`landing-mobile.png`](screenshots/landing-mobile.png) |
| H2 | Keyboard navigation and visible focus indicators | **PASS** | 13 tab stops on `/app`: 0 zero-sized, 0 without an outline or box-shadow indicator. Focus ring restored on console inputs (HEAD commit) |
| H3 | `prefers-reduced-motion` respected | **PASS** | Forced reduce: all 28 reveal elements at opacity 1 with 0 remaining transition delays — the delayed-animation-with-`fill-mode` trap stays fixed |
| H4 | Animations do not affect signing or transaction accuracy | **PASS** | `grep` over `src/components/{landing,ui,legal}`: no import from `src/lib`, and no `fetch`/`XMLHttpRequest`/`WebSocket`. Only `Reclaimer.tsx` and `console/ImportTransaction.tsx` reach the engine; only `src/lib/xverse.ts` imports `sats-connect` |
| H5 | CSP violations absent from the console in production | **PASS** | Zero console errors and zero warnings across all 5 viewports × 6 routes (CSP violations surface as console errors). Header set verified over HTTP (`default-src 'none'`, `frame-ancestors 'none'`, `connect-src` limited to the three broadcast hosts) |
| H6 | No browser memory leak across the flows | **PASS** | 10 alternating `/` ↔ `/app` cycles with a forced GC between samples: JS heap 3 → 12 MB and then flat (11/12/11/12 MB over the last four), i.e. bundle load then steady state, not monotonic growth |
| H7 | Wallet-unavailable messaging and error states | **PASS** | Connect pressed with no provider installed: `REFUSED No Xverse provider was found. Install the Xverse extension, or open this page inside the Xverse in-app browser. [WALLET_NOT_INSTALLED]` — fail-closed, actionable, not a silent no-op |
| H8 | Landing-page demo arithmetic matches the confirmed sweep | **PASS** | Demo button exercised in the browser: 8 result lines, 601,214 sats in / 62,087 sats fee / 539,127 sats net — the confirmed on-chain figures |
| H9 | Xverse disconnect/reconnect and wallet network switches | **NOT VERIFIED** | Requires the extension in a real browser profile. The code paths are covered by `tests/wallet.test.ts` |
| H10 | Scan pagination and large-wallet performance against a live wallet | **NOT VERIFIED** | Requires a funded ordinal wallet; the planner is measured in `docs/PERFORMANCE.md` |

### Defect found and fixed during this pass

At 320px the `/risk` and `/open-source` pages did not reflow: the layout viewport
expanded to 339px and the browser zoomed the page out. Cause: 
`docs/MAINNET_ACCEPTANCE.md` inside a `<code>` span is a 27-character path with no
space and no hyphen, so with `overflow-wrap: normal` it dictated the document's
min-content width. The `.legal-*` block was added without the guard the rest of
the CSS already uses for long mono tokens. Fixed with `overflow-wrap: anywhere` on
`.legal` (`break-word` does not reduce the min-content contribution). Re-measured:
all six routes at 320px now report `innerWidth === scrollWidth === 320` and zero
elements extending past the device width.

## I — Public documentation

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| I1 | Privacy policy page stating what third parties receive | **PASS** | `/privacy` (`app/privacy/page.tsx`) |
| I2 | Terms of use page | **PASS** | `/terms` |
| I3 | Risk disclosure page | **PASS** | `/risk` and `docs/RISK.md` |
| I4 | Open-source information page linking the repository | **PASS** | `/open-source` |
| I5 | Explicitly states inscriptions may travel with the sats and are not erased | **PASS** | `/risk`, `docs/RISK.md`, FAQ, Trust section |
| I6 | Does not claim an audit, guaranteed safety, universal asset detection, universal wallet support, or reversibility | **PASS** | `/risk` "what this project does not claim" table; README |
| I7 | Public site links the real GitHub repository after publication | **PENDING** | Link present in `Footer.tsx`; the URL is live only after Phase 5 |

## J — Final user acceptance

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| J1 | A stranger can find the repo, read the code and understand the risks | **PENDING** | Depends on F2 |
| J2 | A user connects Xverse, scans hundreds/thousands of inscriptions and sees gross BTC, fees and net output | **NOT VERIFIED** | Requires a live wallet and a funded ordinal wallet; synthetic only in this repo |
| J3 | The user independently approves in Xverse and explicitly broadcasts, paying zero platform fees | **NOT VERIFIED** | Requires a live wallet; no platform fee exists in code or pricing |
| J4 | The user can verify the TXID and its confirmation | **PASS** | *Check confirmation* action; verified on chain for the confirmed sweep |

---

## Gate summary

- **PASS with reproducible in-repo evidence:** A1–A10, B1–B4, C1–C6, D1–D6,
  E1–E6, F1, F3–F5, F7–F9, G1–G5, G8, H1–H8, I1–I6, J4.
- **PENDING (verified during Phase 5 and recorded in the final report):**
  F2, F6, I7, J1.
- **FAIL (must be fixed before unrestricted public launch):** E8 (no security
  contact).
- **NOT VERIFIED (no evidence available here):** A11, B5, B6, C7, E7, F10, G7,
  H9, H10, J2, J3.

### Unrestricted public Mainnet launch is blocked by

1. **A11 / E7** — no independent external security audit.
2. **B6** — the provider's real PSBT payload limit is unproven for the largest
   wallets.
3. **E8** — no security contact for vulnerability reports.
4. **B5 / J2 / J3** — no live-wallet end-to-end acceptance run from this
   environment.

The public repository can still ship as an independently useful, inspectable,
self-buildable artifact while these are open. What must not ship is an
unrestricted, Mainnet-broadcast-enabled public site.
