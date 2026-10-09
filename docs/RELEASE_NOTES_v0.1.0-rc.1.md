# v0.1.0-rc.1 — release candidate notes

**Status: historical draft, superseded by [v0.1.0-rc.2](RELEASE_NOTES_v0.1.0-rc.2.md), NOT published.** There is no tag and no GitHub release. The
text below is what would be published, and it is deliberately specific about what
has and has not been verified. Do not publish it while the open items at the
bottom are open.

**Source version `0.1.0-rc.1`** (`package.json`). The archival commit is named in
the release body when the tag is made, not in this file, for the reason given under
[Checksums](#checksums).

This is a **source-only release candidate**. No binaries, installers, container
images or native packages are produced, because producing them properly means
building and testing them on each platform, and only Linux has been verified here.
See [Supported platforms](#supported-platforms).

---

## What this is

SAT//RECLAIMER is a free, open-source, non-custodial web app you run **on your own
machine** to spend the bitcoin locked inside unwanted Ordinals inscription UTXOs
and sweep it to an address you choose.

- No account, no sign-up, no server component.
- No platform fee, no subscription, no paid tier. The Bitcoin network fee is paid
  to miners and is the only cost.
- No custody: your wallet signs, this app never sees a key.
- Runs on `127.0.0.1` and is not reachable from your network.

**An inscription-bearing UTXO is still a Bitcoin UTXO.** Spending it moves
whatever it carries. This tool does not delete inscriptions, convert them into
bitcoin, or protect you from that — it lets you opt into it deliberately.

## Installation

Four commands. No administrator rights, no `curl | bash`, nothing downloaded and
executed from a third party.

```bash
git clone https://github.com/echelong/sat-reclaimer.git
cd sat-reclaimer
corepack enable
pnpm install
pnpm local
```

Then open <http://127.0.0.1:3000> and go to `/app`.

`pnpm local` asks which mode to run in and prints exactly what it is about to
enable. The default — the one you get by pressing Enter — cannot spend anything.
Full per-platform instructions, the manual install path, and troubleshooting are
in [`docs/LOCAL_SETUP.md`](LOCAL_SETUP.md).

Requires **Node.js 22 or newer** and **pnpm 10**. Nothing else: no database, no
Docker, no server.

## Supported platforms

| Platform | Status |
| --- | --- |
| Linux (Fedora 43, x86_64) | **Verified.** Cloned, installed, built, served and exercised in a browser on this platform. |
| Linux, other distributions | **Not verified.** Nothing in the build is distribution-specific, but this has not been run. |
| macOS | **Not verified.** No macOS environment was available. The toolchain and scripts are platform-neutral Node.js; that is an expectation, not a test result. |
| Windows | **Not verified.** No Windows environment was available. `scripts/start-local.mjs` handles the `pnpm.cmd` shim, and the Node scripts avoid shell metacharacters; again an expectation, not a test result. |

If you run it on macOS or Windows, the platform column above is what a report
should move. Opening an issue with your OS, Node version and the output of
`pnpm local:check` is genuinely useful.

## Supported wallets

| Wallet | Status |
| --- | --- |
| **Xverse** (extension or in-app browser), via Sats Connect | The only supported wallet. |
| Any other wallet | Not supported. The console says so rather than failing obscurely. |

Xverse must expose a Taproot **Ordinals** address (`bc1p` / `tb1p`). The app proves
that address is the BIP86 output of the public key the wallet reports before it
builds anything.

## Security disclosures

Read these before connecting a wallet.

- **This software has not been independently audited.** No external security
  review has been performed. An internal review exists
  ([`docs/SECURITY_REVIEW.md`](SECURITY_REVIEW.md)) and is not a substitute for an
  independent one.
- **Asset detection is structurally incomplete.** The interface this app can read
  does not report runes, BRC-20 balances or rare sats at all, so it never claims an
  output is safe and never infers safety from an inscription count.
- **Spending is irreversible.** Inscriptions, rare sat ranges, rune balances and
  BRC-20 state can move with the sats, and there is no support process, refund or
  recovery path.
- **Broadcasting is never automatic.** It requires an operator flag, a
  per-transaction authorization for one exact `txid`, and a locally recomputed hash
  that must match.
- **The network flags are product policy, not a security boundary.**
  `NEXT_PUBLIC_*` values are public browser configuration. What protects your
  bitcoin is that your wallet approves one exact transaction and this app verifies
  the signed bytes before anything else can happen.
- **No seed phrase or private key is ever requested, stored or transmitted**, and
  there is no field anywhere in the app for one.
- Report a vulnerability privately through GitHub's **Report a vulnerability**
  button, not a public issue. See [`SECURITY.md`](../SECURITY.md).

## Known limitations

1. **A page refresh loses a signed transaction.** It lives in browser memory only
   and is never written to disk or sent anywhere. Use *Download verified .hex*
   before refreshing; the *Recover a saved transaction* panel can bring it back and
   submit it without signing again. Automatic recovery is deliberately not
   implemented, and recovery never broadcasts on its own.
2. **Xverse's real PSBT payload limit is unproven.** Local signing has been
   measured up to 10,000 inputs ([`docs/PERFORMANCE.md`](PERFORMANCE.md)), but the
   largest count approved by a real wallet **with an artifact behind it** is 1,079.
   The operator reports a large-payload run working, but no input count was
   recorded, so the limit remains unproven and a very large sweep may still need
   several signature requests.
3. **No *evidenced* live Signet/Testnet end-to-end run.** No inscription-bearing
   Signet UTXO exists to spend here, so the non-Mainnet path has never been shown
   completing against a real chain. The operator reports an end-to-end broadcast
   (case M9) and reported that case on Signet/Testnet terms, but did not state the
   chain or supply a txid, so this stands as written.
4. **Xverse only.** There is no second signer to fall back to.
5. **Broadcast endpoints are third parties** (`mempool.space`, `blockstream.info`,
   `mempool.emzy.de`). They see the transaction and a `txid` lookup; behaviour
   under rate limiting and outage is handled but not exhaustively tested against
   the live services.
6. **No security contact outside GitHub.** GitHub private vulnerability reporting
   is enabled and verified on the repository, but it requires a GitHub account, and
   there is no security email address or PGP key.
7. **No acceptance result is formally verified.** The operator reports every manual
   acceptance case working, but a report is not a checkable artifact. Gates B5, C9,
   H9, H10, J2 and J3 therefore remain open, and this build carries exactly the same
   caveats as the previous one on all of them.
8. **Staging-deployment gate G7 is proposed for removal, not satisfied.** Local-first
   distribution has no staging surface to protect. The proposal is recorded in
   [`docs/RELEASE_GATES.md`](RELEASE_GATES.md#proposed-scope-change-g7-staging-deployment--awaiting-owner-approval)
   and no status change has been applied.

## Test results

Measured on the release candidate commit; reproduce with `pnpm verify`.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm lint` | exit 0 | `eslint .` |
| `pnpm typecheck` | exit 0 | `tsc --noEmit`, strict |
| `pnpm test` | 242 passed, 1 skipped (243 total) | 10 test files, no network access, no Mainnet transaction. The one skip is the 10,000-input plan, which is behind `pnpm test:max` |
| `pnpm test:max` | 7 passed | `tests/large-wallet.test.ts` with `LARGE_WALLET_MAX=1`, including the 10,000-input plan |
| `pnpm build` | exit 0 | 11 static pages generated |
| Dependency audit | no known vulnerabilities in the shipped tree | `pnpm audit --prod --audit-level=high`; one dev-only advisory is waived by name in `scripts/audit-allowlist.mjs` |
| Secret scan | passes on full history and working tree | `./scripts/scan-secrets.sh`, `--tree` |
| CI on `master` | green | lint/typecheck/test/build, large-wallet, secret scan, dependency review, CodeQL |

The suite is offline: broadcast tests use a fake transport and wallet tests use a
mocked provider, so no live endpoint is contacted and no real transaction is ever
created by the tests.

**What the tests do not cover:** anything requiring a real browser wallet. Connection,
disconnect, network switching, live scanning, live signing and live broadcast are
all unexercised by this repository. [`docs/MANUAL_ACCEPTANCE.md`](MANUAL_ACCEPTANCE.md)
is the operator procedure for those.

**On those cases, precisely:** the operator reports **all nine** working (M1–M9).
Every one of them is recorded as `PROVISIONAL PASS`, because the artifacts that would
let a second party check any of them — the chain used, browser and Xverse versions, a
redacted screenshot, the scan figures, the accepted input count, the verification
verdict, a txid — were not supplied. **No release gate moved as a result, and none
should.** The seven artifacts that would change that are listed in
`docs/MANUAL_ACCEPTANCE.md` under *Evidence still outstanding*.

Two of those distinctions are worth stating where a user will see them, because they
are easy to get wrong in a release note:

- **The large-payload case passing does not prove Xverse's payload limit.** That gate
  (B6) is the requirement that a *stated* number of inputs was accepted; no number
  was recorded.
- **A recovery test passing does not mean a signed transaction survives a refresh.**
  It does not, by design — see Known limitations 1.

## The one confirmed real sweep

The operator previously swept a real 1,079-input inscription wallet on Mainnet:
txid `0a7d30ca8f940b137c96c65bb32ffec34f53a8a128cadf154f8df83055257e1a`,
confirmed in block **970454**, 248,348 WU / 62,087 vB, fee 62,087 sats at exactly
1 sat/vB, one P2SH output of 539,127 sats.

That is historical evidence that the flow worked, once, on an earlier version,
driven by an operator who could see the screen. It is **not** a substitute for
testing this version, and it does not exercise cancellation, recovery,
disconnect/reconnect or network switching. Details, including what it does not
prove, are in [`docs/MAINNET_ACCEPTANCE.md`](MAINNET_ACCEPTANCE.md).

## Checksums

No binaries are produced, so there are no artifact checksums to publish. Verify the
source the usual way instead: build from the tagged commit, and compare the commit
SHA you built against the one named in the release.

```bash
git clone https://github.com/echelong/sat-reclaimer.git
cd sat-reclaimer
git checkout v0.1.0-rc.1
git rev-parse HEAD            # must equal the commit named in the release
pnpm install --frozen-lockfile
pnpm verify
```

`--frozen-lockfile` installs exactly the versions in `pnpm-lock.yaml` and fails
rather than resolving anything else.

If a source archive is published beside the tag, its hash goes in the release body
and is reproducible from the same commit:

```bash
git archive --format=tar.gz --prefix=sat-reclaimer-0.1.0-rc.1/ v0.1.0-rc.1 | sha256sum
```

That command is deterministic — verified by running it twice on the same commit and
comparing digests — because `git archive` writes a zeroed mtime into the gzip
header rather than the current time. The digest itself is deliberately **not**
recorded in this file: writing it here would change the very commit it describes.
Record it in the release, where it can be checked against an artifact instead of
against itself.

## Do not publish yet

This candidate is not published because these are open, and publishing a release
implies more than the evidence supports:

- **No independent external security review** — gates A11/E7.
- **Xverse's real payload limit is unproven** — gate B6; no accepted input count was
  recorded.
- **No acceptance result is formally verified** — the operator reports all nine cases
  working, and gates B5, C9, H9, H10, J2 and J3 stay **NOT VERIFIED** regardless.
  The seven artifacts that would change that are listed in
  [`docs/MANUAL_ACCEPTANCE.md`](MANUAL_ACCEPTANCE.md). The M9 **txid and network** is
  the one that matters most: it is the only item on the list that a third party can
  check without trusting the person who supplied it.
- **C8 is open by design** — a signed transaction does not survive a refresh without
  user action; the import panel is the shipped alternative, not a fix for it.
- **No security contact outside GitHub** — gate E11, pending owner input. (GitHub private vulnerability reporting itself is enabled and verified — gate E8.)
- **Windows and macOS unverified** — gates K9/K10; see [Supported platforms](#supported-platforms).
- **G7 (staging deployment) is propose-for-removal, not satisfied** — it needs an
  owner decision, and no status change has been applied.

The full gate list, with evidence, is [`docs/RELEASE_GATES.md`](RELEASE_GATES.md).

## Tagging this release candidate (owner action — not yet taken)

None of the commands below has been run. They are written down so the decision is
one deliberate step, and they stay manual on purpose:

```bash
# 1. Confirm the commit, and that CI is green on it.
git rev-parse HEAD
gh run list --limit 1

# 2. Tag locally first, and read the tag back before pushing anything.
git tag -a v0.1.0-rc.1 -m "SAT//RECLAIMER v0.1.0-rc.1 (source-only release candidate)"
git show --stat v0.1.0-rc.1

# 3. Push the tag only on an explicit go-ahead.
git push origin v0.1.0-rc.1

# 4. Publish as a pre-release, never as "latest".
gh release create v0.1.0-rc.1 --prerelease \
  --title "v0.1.0-rc.1 — source-only release candidate" \
  --notes-file docs/RELEASE_NOTES_v0.1.0-rc.1.md
```

Two deliberate choices in there: the release is marked `--prerelease` so it is never
offered as the stable download, and the archive hash from [Checksums](#checksums) is
added to the release body rather than committed here.
