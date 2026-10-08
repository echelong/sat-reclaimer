# Security policy

Sat Reclaimer builds, verifies and broadcasts Bitcoin transactions. A flaw here
can cost someone real money, so reports are taken seriously and handled privately
first.

## Reporting a vulnerability

**Do not open a public issue for anything exploitable.**

Use GitHub's private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. That channel is private, it notifies
the maintainer directly, and it keeps the report out of public search indexes.

Please include:

- what the flaw is, and which file or function it lives in
- the conditions required to trigger it, and what an attacker gains
- whether it can affect a **Mainnet** transaction, and whether it needs the user
  to do something unusual
- a minimal reproduction if you have one — a test case, a PSBT, a raw
  transaction, or the exact commands
- whether you intend to publish, and on what timeline

Do **not** include a seed phrase, private key, wallet file, or any unredacted
key material, even if you believe it is already compromised. Redact wallet
addresses and transaction identifiers unless they are already public on chain and
relevant to the report.

### No email address is configured

There is no security email address, PGP key or bug-bounty programme. GitHub's
private reporting is the only intake channel, and it requires the reporter to
hold a GitHub account. This is recorded as an open item in
[`docs/RELEASE_GATES.md`](docs/RELEASE_GATES.md) rather than papered over with an
invented address. If you need a different channel, say so in a public issue that
contains no vulnerability detail, and one will be arranged.

## Response expectations

This is a small project without a paid security team. The intent is:

| Stage | Target |
| --- | --- |
| Acknowledgement | 3 working days |
| Initial assessment and severity | 10 working days |
| Fix for a critical or high finding | as fast as is safe; interim mitigation documented first |
| Public credit | on request, in the release notes |

If a finding is critical and reachable on Mainnet, the first action is to disable
the affected capability — Mainnet, broadcasting, or both — rather than to argue
about severity. Disabling Mainnet requires setting `NEXT_PUBLIC_ENABLE_MAINNET` to
anything other than `"true"`, and the application refuses to build a Mainnet
sweep without it.

## Supported versions

| Version | Supported |
| --- | --- |
| `master` | yes |
| tagged releases | the most recent tag only |
| anything older | no |

There are no released versions yet. Until there is a tag, only `master` is
supported, and `master` is a public beta.

## Scope

In scope:

- Anything in `src/lib` — the Bitcoin engine.
- The flow wiring in `src/components/Reclaimer.tsx` and
  `src/components/console/ImportTransaction.tsx`.
- The operator flags, their defaults, and anything that could let a transaction be
  built, signed, verified or broadcast without the documented gates.
- Anything that could cause a user to sign a transaction other than the one they
  reviewed.
- Anything that could cause a transaction to be broadcast twice, rebroadcast after
  an ambiguous response, or signed as a replacement.
- Anything that could leak key material, or that could lead a user to hand it over.

Out of scope:

- Xverse, `sats-connect`, and any wallet implementation.
- The ordinals indexer behind the wallet's inscription API.
- mempool.space, blockstream.info and any other public node's availability or
  policy decisions.
- The risk that inscriptions, runes, BRC-20 state or rare sats move when their
  output is spent. That is the documented, acknowledged purpose of the tool, not a
  vulnerability — see [`docs/RISK.md`](docs/RISK.md).
- A confirmed transaction being irreversible, and network fees being real money.
- Compromise of a user's own machine, browser extension or wallet.

## What this project will never do

So that no report needs to establish it:

- Request, derive, import, store, transmit or log a seed phrase or private key.
- Take custody of funds, hold a deposit address, or run an account system.
- Broadcast automatically, or broadcast a transaction the user did not
  individually authorize by txid.
- Claim that a broadcast is confirmed without checking its on-chain status.
- Claim an audit that has not happened.

## Dependencies

A Bitcoin transaction tool that ships a known vulnerable dependency is shipping a
vulnerability, so dependency state is treated as part of the security surface
rather than as housekeeping.

Every change to `pnpm-lock.yaml` is covered by two gates in CI:

1. `pnpm audit --prod --audit-level=high` — anything that reaches a user fails the
   build at high or critical severity.
2. `scripts/audit-allowlist.mjs` — the rest of the tree, including build and test
   tooling. Any new high or critical advisory fails the build.

The only standing exception is `braces` (GHSA-vfj7-8cjw-p6xm), reachable solely
from the ESLint glob chain. It never enters the application bundle, `3.0.3` is the
newest release and the advisory lists no patched version, so the waiver is written
by name into that script with its reasoning rather than hidden in a threshold.
Adding anything to that list requires it to be dev-only *and* unfixable, and the
reason has to say so.

Two dependencies inherited from `sats-connect` are overridden deliberately.
`sats-connect` exact-pins `@sats-connect/core` and `valibot`, which in turn pin
`axios 1.12.0` and `valibot 1.1.0`; both land in the browser bundle and both carry
published advisories. `pnpm.overrides` moves them to `axios 1.20.0` and
`valibot 1.5.0`. Both are within the same major as the pins, and the override is a
reviewed decision, not a silent resolution: if `sats-connect` ships fixed pins,
the overrides should be removed. Note the honest limit — the wallet integration is
not exercised against a live provider here, so real-wallet behaviour at the
overridden versions is covered by release gate B5/B6, not by the test suite.

## A note on what is *not* protected

An inscription-bearing UTXO is an ordinary Bitcoin UTXO. Spending it can move the
inscription, rare sats, runes, BRC-20 state or anything else it carries. Asset
detection through the interface this app can read is **structurally incomplete** —
runes, BRC-20 balances and rare sats cannot be detected at all — so the tool never
claims an output is safe and never infers safety from an inscription count. Every
user has to acknowledge that before an output becomes selectable. That is a
product property, not a bug to report.
