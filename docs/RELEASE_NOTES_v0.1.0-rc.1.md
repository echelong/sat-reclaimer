# v0.1.0-rc.1 — release candidate notes

**Status: prepared, NOT published.** There is no tag and no GitHub release. The
text below is what would be published, and it is deliberately specific about what
has and has not been verified. Do not publish it while the open items at the
bottom are open.

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
   largest count approved by a real wallet is 1,079. A very large sweep may need
   several signature requests.
3. **No live Signet end-to-end run.** No inscription-bearing Signet UTXO exists to
   spend, so the non-Mainnet path has never completed against a real chain.
4. **Xverse only.** There is no second signer to fall back to.
5. **Broadcast endpoints are third parties** (`mempool.space`, `blockstream.info`,
   `mempool.emzy.de`). They see the transaction and a `txid` lookup; behaviour
   under rate limiting and outage is handled but not exhaustively tested against
   the live services.
6. **No security contact outside GitHub.** GitHub private vulnerability reporting
   is enabled and verified on the repository, but it requires a GitHub account, and
   there is no security email address or PGP key.

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
all unexercised here. [`docs/MANUAL_ACCEPTANCE.md`](MANUAL_ACCEPTANCE.md) is the
operator procedure for those, and every case in it is currently `NOT RUN`.

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

## Do not publish yet

This candidate is not published because these are open, and publishing a release
implies more than the evidence supports:

- **No independent external security review** — gate A11/E7.
- **Xverse's real payload limit is unproven** — gate B6.
- **No live-wallet acceptance run on this version** — gates B5, J2, J3.
- **No security contact outside GitHub** — gate E11, pending owner input. (GitHub private vulnerability reporting itself is enabled and verified — gate E8.)
- **Windows and macOS unverified** — see [Supported platforms](#supported-platforms).

The full gate list, with evidence, is [`docs/RELEASE_GATES.md`](RELEASE_GATES.md).
