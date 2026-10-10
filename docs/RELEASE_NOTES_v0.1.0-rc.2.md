# v0.1.0-rc.2 — local beta candidate

**Prepared for owner review; NOT tagged or published.** Supersedes the unpublished
rc.1 draft. This candidate includes transaction-session safety fixes and a change
to the normal launcher, so it has a new source version. MIT licensing, GitHub-only
distribution and the existing Bitcoin engine remain unchanged.

SAT//RECLAIMER deliberately spends inscription-bearing Bitcoin UTXOs. Assets
carried by those outputs can move permanently. It is free and non-custodial:
Xverse signs; no seed phrase or private key is requested. Only mining fees apply.

## Changes

- RC2 production browser acceptance at 1440, 1280, 834, 390 and 320 px, with
  offline wallet/node fixtures. Narrow review grids and long identifiers now wrap
  correctly; status banners no longer cover review and authorization. Multi-batch
  summaries accurately label the largest batch. Browser regressions run in CI.

- Fractional fee input is refused instead of silently rounded. Whole-number
  sat/vB rates are supported.
- Wallet size fallback cannot repartition earlier signed batches or discard their
  recovery files and submission results. An unsigned fallback requires review of
  the new aggregate fee and a fresh signing phrase.
- Null provider totals no longer stop scanning after one page. Malformed totals
  fail; changing or contradictory totals keep Sweep All blocked.
- Network changes and failed wallet operations clear stale local state. Duplicate
  wallet actions are blocked before the disabled button renders.
- Individual UTXO selection is available in pages of 100 outputs. Scan progress
  reports pages and inscriptions received. Unsigned edits invalidate the review;
  signed plans lock destination, input selection and fee rate.
- Broadcasting submits once per txid per session. Timeout or HTTP 503 leads to
  independent status lookups, never an automatic POST to another endpoint. Failed
  and ambiguous attempts stay recorded, and attempted batches cannot be re-signed.
  Both normal and recovery flows expose read-only confirmation checking.
- Recovery enforces explicit authorization in the submission handler. Editing the
  raw bytes or changing network clears earlier recovery approval.
- `pnpm local` builds and runs production by default. `--dev` is an explicit
  contributor option. Every production launch rebuilds with the selected flags;
  stale build flags cannot be reused by this launcher.
- Shutdown forwards signals to the server; invalid ports and failed builds stop
  before serving. Generated Next.js declarations are no longer tracked.
- CI fails if rendered product flags are enabled or missing, or Mainnet is unlocked.
- Dependency review fails on incomplete registry responses. Unsigned benchmark
  results no longer claim a measured raw transaction size.

## Installation

Requires Node.js 22+ and the pinned pnpm 10.17.1. On a user-owned Node installation,
use `corepack enable` if Corepack is installed; otherwise install the exact manager
with `npm install --global pnpm@10.17.1`.

```bash
git clone https://github.com/echelong/sat-reclaimer.git
cd sat-reclaimer
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm local:check
pnpm local --mode=plan
```

Open <http://127.0.0.1:3000/app>. Stop with Ctrl+C. The server binds only to
`127.0.0.1`; no hosted service, database or native framework is required.
The default mode disables Mainnet and all broadcasting. Signing on test networks
still requires explicit Xverse approval. Mainnet modes require a deliberate
launcher choice; signing and broadcasting always remain separate user actions.

[`LOCAL_SETUP.md`](LOCAL_SETUP.md) covers modes and troubleshooting. Direct
`pnpm dev` can read `.env.local`; direct `pnpm start` uses previously baked flags.
Use the launcher for safe mode selection.

## Verification and support

The current results and exit codes are recorded in
[`M10_BROWSER_ACCEPTANCE.md`](M10_BROWSER_ACCEPTANCE.md), with earlier results in
[`M9_VALIDATION.md`](M9_VALIDATION.md). Protocol tests use deterministic fixtures,
mock wallet providers and fake transports, never real-money transactions.

- Linux: historical Fedora 43 evidence; M9 installation and production HTTP
  startup on Fedora 44 x86_64, Node 24.20.0, pnpm 10.17.1.
- Windows and macOS: **not verified**; no compatibility claim.
- Chromium 147 production acceptance: **25/25 state/width checks pass**, with
  keyboard, reduced-motion and fixture interaction evidence. Firefox/Safari and
  live Xverse on this candidate: **not verified**.
- External Bitcoin audit: **outstanding**. Internal regression testing is not an
  independent security review.

## Limits and security disclosures

The [release gates](RELEASE_GATES.md) retain **80 PASS / 14 NOT VERIFIED / 0 FAIL**.
This is **85.1% of recorded gates**, not a Mainnet readiness percentage.
The owner reports 9/9 manual cases successful; **0/9 are formally verified**.
The owner has since reported the newer transaction confirmed; its TXID and
network remain unrecorded. This is operator-reported confirmation, not
independently verified chain evidence. No lookup was performed.

- Asset detection cannot rule out runes, BRC-20 assets or rare sats.
- Xverse is the only supported wallet; its real maximum PSBT payload is unproven.
- The 10,000-input run plans and measures six batches; it does not sign them or
  prove a wallet payload limit. A measured Chromium
  run blocked the UI for 58.7–68.8 seconds while planning 10,000 inputs; this is a
  known beta limitation. The largest batch leaves only 4,178 WU (1.0445%) below
  the 400,000 WU standard limit.
- Refresh loses the in-memory signed transaction. Download verified `.hex` bytes
  first. Saved signed files contain no private keys but can authorize spending
  those inputs when submitted. Resolve submitted or ambiguous txids before
  rebuilding. Recovery requires fresh authorization and never auto-broadcasts.
- A later payload rejection after earlier batches were signed preserves the plan
  and refuses repartitioning. Save files and resolve submissions before rescanning.
- Raw recovery cannot establish input amounts, fee, ownership or chain from bytes
  alone. Check destination, fee and network independently before submitting.
- `NEXT_PUBLIC_*` flags are public product configuration, not a security boundary.
- Nodes see broadcast transactions and status requests. The attempt ledger lives in memory; after refresh, check submitted txids
  independently before importing or rebuilding. No analytics or custody.
- GitHub private vulnerability reporting is available; a security contact outside
  GitHub remains outstanding. See [SECURITY.md](../SECURITY.md).

## Source and checksums

No binaries or installers are distributed. Build from the reviewed commit SHA,
recorded in the release body only after owner approval. No tag is needed to prepare
and verify a deterministic archive:

```bash
git archive --format=tar.gz --prefix=sat-reclaimer-0.1.0-rc.2/ HEAD > sat-reclaimer-0.1.0-rc.2.tar.gz
sha256sum sat-reclaimer-0.1.0-rc.2.tar.gz
```

Create the archive outside the checkout, compare repeated digests, and publish
its checksum alongside the source artifact if the owner approves publication.
The existing audit, wallet-evidence and security-contact blockers remain open.
Follow [`RC2_RELEASE_INSTRUCTIONS.md`](RC2_RELEASE_INSTRUCTIONS.md) and the final
release packet for the reviewed SHA and checksum. No Git tag or GitHub release
may be published without explicit owner approval.
