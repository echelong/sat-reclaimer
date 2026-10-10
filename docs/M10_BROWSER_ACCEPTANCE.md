# M10 — RC2 production browser acceptance

Date: 2026-10-10, Rio PC (Fedora 44 x86_64, Node 24.20.0, pnpm 10.17.1).
This is internal engineering evidence, **not** an independent Bitcoin audit or
live Xverse acceptance. No live Bitcoin signing, broadcasting or chain lookup
was performed.

## Git baseline and scope

Started on clean public `master` at
`ea20f6268f0e370baffc9f334501e80f00f7a744`, matching the requested RC2 and fetched
`origin/master`. No local work needed stashing or removal. Integration uses a
temporary `m10/rc2-browser-acceptance` PR branch, then returns to one local/remote
`master`. No force push, tag, release or hosted deployment is part of M10.

Three confirmed presentation defects were corrected; no Bitcoin engine,
verification guard, signing policy or broadcast transport was changed:

1. **Narrow transaction panels overflowed.** Before the fix the pre-sign review
   had a 366 px document width at 320 px, and signed review reached 627 px at
   390/320 px. Nested batch/data/check grids now shrink to their container;
   long flags, txids and provider messages wrap without clipping. A follow-up
   browser assertion caught a remaining long flag at 350 px before the final fix.
2. **Sticky status obscured the signed review.** A mobile screenshot showed it
   overlapping the refresh warning, export action and authorization checkbox.
   Status/error messages remain in normal document flow with `aria-live` intact.
3. **Largest batch was incorrectly labelled “each.”** The 10,000-input review
   claimed the largest weight/vsize for every batch. It now says **largest** and
   still shows the aggregate total; individual batch measurements remain visible.

A later CodeQL PR check found two high-severity `js/insecure-temporary-file`
alerts in the new QA runners: predictable log/evidence files under `/tmp` could
be replaced with symlinks by another local user. Both runners now allocate
fresh private directories with `mkdtemp` before writing files. No suppression
or waiver was added. This storage fix is confined to the offline QA harness;
the final CodeQL check must show those findings resolved before merge.

## Real rendered browser evidence

The **production launcher**, not `next dev`, rebuilt `plan` and `testnet` modes
and served loopback only. An occupied port 3210 produced `EADDRINUSE`, exit 1 and
port-change guidance; the QA server used 33217. Launchers shut down through their
signal-forwarding path after each mode.

Browser: isolated headless **Chromium 147.0.7727.15**, Playwright 1.58.2.
No installed wallet extension/profile was opened. The provider fixtures enter
through the real Sats Connect provider API, not an application test hook. Test
signatures use the existing deterministic offline fixture key in the harness;
every external HTTP request is intercepted before transport. Mainnet is disabled
in both builds. The plan run produced **zero POSTs**; the testnet run produced
exactly two intercepted POSTs across separate sessions, never a live submission.

| Rendered state | 1440 | 1280 | 834 | 390 | 320 |
| --- | --- | --- | --- | --- | --- |
| Landing | PASS | PASS | PASS | PASS | PASS |
| Idle console | PASS | PASS | PASS | PASS | PASS |
| Individual selection | PASS | PASS | PASS | PASS | PASS |
| Pre-sign review | PASS | PASS | PASS | PASS | PASS |
| Verified transaction review | PASS | PASS | PASS | PASS | PASS |

All **25** final state/width observations have document width equal to viewport
width and no off-screen console elements. These assertions failed on the
unfixed review. Screenshots were actually inspected, including mobile verified
destination, complete txid, fee, refresh warning, download and authorization.
Single-line destination inputs scroll internally; review addresses wrap in full.

Evidence lives in [`m10/`](m10/): JSON records the browser, viewport bounds,
provider/transport calls and assertions; selected PNGs show the actual UI. Raw
fixture recovery files remain outside Git. The earlier scale timing observation
is retained separately from the final regression run.

## Interaction acceptance (safe fixtures)

- **Scan and selection:** visible `Scanning: 100 of 205 inscriptions, 1 pages
  read…`, busy scan/network controls disabled, then 205 outputs across pages
  100/100/5. Selection persists between pages; last-page navigation disables.
  Enter opens details and Space toggles a UTXO. Incomplete provider totals block
  review; failed rescans discard stale state.
- **Wallet errors and races:** missing provider gives install guidance; cancelled
  connect/sign requests give coded refusals; wrong wallet network refuses connect.
  Three rapid connect clicks issue one connect; three rapid sign clicks issue one
  `broadcast:false` request. Failed disconnect clears local wallet/scan state;
  changing Signet/Testnet requires reconnect and clears the previous context.
- **Review:** destination/fee changes invalidate unsigned review, fractional rates
  refuse, and a high fee produces the destructive cost warning. Independently
  verified signed plans disable fee, destination, selection and rebuild controls.
  Export downloads the verified raw bytes. A fixture payload rejection replans
  five outputs into 2/2/1, clears the phrase and labels largest/total accurately.
  A later rejection preserves already signed bytes and refuses repartitioning.
- **Refresh and recovery:** refresh discards the signed session. Paste/file import
  inspects locally, states unknown input values/fee/ownership/chain, and requires
  fresh checkbox/phrase authorization. Editing raw bytes or changing network
  clears inspection/approval. Malformed bytes refuse. No import auto-submits.
- **Ambiguous submission:** rapid normal and recovery submits each issue one
  intercepted HTTP POST. HTTP 503 followed by unknown/offline GET status lookups
  leaves the outcome ambiguous and prevents re-signing/resubmission. Importing
  the same txid in-session shares the attempt ledger. Read-only checks display
  fixture mempool, confirmed block 123456, unknown and unavailable outcomes;
  confirmation checks add no POST. These statuses are **simulated**, not chain
  evidence.
- **Keyboard/motion:** idle mobile Tab order reaches skip link, home, network,
  connect, fee, recovery textarea, inspect and load controls with 2 px solid focus
  rings. Browser-chrome/body transitions are excluded from control assertions.
  Landing menu responds to Enter/Escape. Reduced-motion reveals are fully visible,
  smooth scroll is off and no animation remains running in the console.
- **Browser errors:** no uncaught page error, failed local resource, unexpected
  console message or observed CSP violation. Expected intercepted 404/503 and
  offline transport errors are retained in the evidence, not called a clean
  transport run. Firefox/Safari and live Xverse were not exercised.

Harness-development failures (wrong accessible selectors, Next's second alert
element and an assertion initially applied to the landing route) were corrected
and rerun. They are not counted as product defects or successful acceptance.

## Scale and responsiveness

[`PERFORMANCE.md`](PERFORMANCE.md#m10-rendered-browser-responsiveness) records
the actual timer/long-task measurement: **58.9 seconds** to render the
10,000-input review, with a **58.7-second synchronous browser stall**. A repeat after the copy fix took 69.0 seconds with a 68.8-second long task.
Pagination before planning took 59–65 ms across those observations. This fails a claim of continuously
responsive large planning; it remains an explicit beta limitation. Timings ran
concurrently with offline tests and are not isolated performance promises.

Six batches (1,720 × 5 + 1,400) cover the fixture selection. Largest:
**395,822 WU**, leaving **4,178 WU / 1.0445%** below the 400,000 WU standard
limit, and just 178 WU below the 396,000 WU planner budget. This is a small safety
margin, not authority to support unmeasured witness shapes. The browser scale
run made **zero signing requests**. Xverse's real maximum payload stays unproven.

## Validation and reproduction

| Check | Actual result |
| --- | --- |
| Lint / typecheck | exit 0 |
| Full offline suite | 307 passed, 1 scale skip, 15 files; exit 0, 413.15 s |
| Console handlers after presentation fix | 10/10, exit 0 |
| Performance suite | 7/7 including 10,000, exit 0, 448.59 s |
| Production builds / launcher QA | rebuilt plan/testnet, exit 0 acceptance |
| Production dependency audit | no known vulnerabilities, exit 0 |
| Full dependency audit | existing named dev-only `braces` waiver only; allowlist exit 0 |
| Tree and full-history secret scans | both exit 0 |

The final PR CI validates the merged implementation separately, including the new
production browser job and CodeQL. Final run links and the exact merged source
SHA are supplied in the release packet/report; do not infer them from this file's
own Git commit. No tag or release is created by CI.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:browser --scale
pnpm verify
pnpm test:max
pnpm audit --prod --audit-level=high
pnpm audit --json > /tmp/rc2-audit.json || true
node scripts/audit-allowlist.mjs /tmp/rc2-audit.json
./scripts/scan-secrets.sh --tree
./scripts/scan-secrets.sh
```

## Release decision and progress

**Recommend owner-reviewed source-only local-beta publication**, conditional on
successful final PR/master CI and explicit owner approval of the stated limits.
Do not publish a hosted Mainnet interface or claim unrestricted Mainnet readiness.
Use [`RC2_RELEASE_INSTRUCTIONS.md`](RC2_RELEASE_INSTRUCTIONS.md).

The newer transaction is now **owner-reported confirmed**, superseding the earlier
mempool report. Its TXID and network are still missing. No independent lookup or
new chain-confirmation claim was made, and no evidence gate moves.

```text
Recorded release gates      [█████████████████░░░] 80/94 PASS (85.1%)
Open evidence gates         [███░░░░░░░░░░░░░░░░░] 14/94 NOT VERIFIED
Rendered RC2 state/width QA  [████████████████████] 25/25 PASS
Live manual artifacts       [░░░░░░░░░░░░░░░░░░░░] 0/9 formally verified
Owner reports               [████████████████████] 9/9 provisional
Independent external audit  [░░░░░░░░░░░░░░░░░░░░] outstanding
Publication authorization   [░░░░░░░░░░░░░░░░░░░░] awaiting owner
```

These are scoped counts, not a Mainnet readiness score. A11/E7 (external audit),
B5/B6/H9/H10/J2/J3 (live wallet evidence), C9 (test-chain end-to-end), E11
(outside-GitHub security contact), G7 (owner scope decision), K9/K10 (Windows/macOS)
remain open. C8's automatic refresh persistence is deliberately absent; manual
export/import does not close it. No gate is silently retired or converted to PASS.
