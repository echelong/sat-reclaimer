# Contributing

Thanks for looking. This is a small, security-sensitive Bitcoin tool, so the bar
is less about volume and more about provability.

**Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first.** It is short and it
explains why the code is shaped the way it is; almost every review comment on a
first pull request is answered in it.

## The rules that are never negotiable

These come from [`CLAUDE.md`](CLAUDE.md) and [`SECURITY.md`](SECURITY.md). A pull
request that breaks one will be closed rather than patched:

1. **Never request, persist, log or transmit a seed phrase or private key.** There
   is no field for one and there never will be.
2. **Signing and broadcasting stay separate operations.** `signPsbt` always sends
   `broadcast: false`.
3. **Never broadcast automatically**, and never resubmit after an ambiguous
   response. Resolve ambiguity by looking the txid up, never by sending it again.
4. **Every transaction is decoded and invariant-checked independently of the code
   that built it.** The verifier in `src/lib/verify.ts` may not import a value the
   builder computed.
5. **Deduplicate inputs by `txid:vout`.**
6. **Never infer asset safety from an inscription count**, and never present gross
   input sats as recovered bitcoin.
7. **Never disable a guard to make a test pass.** If a guard is wrong, fix the
   guard and add a test that fails without the fix.
8. **No custody.** No server that holds funds, no deposit address, no account.

## Getting set up

```bash
git clone https://github.com/echelong/sat-reclaimer
cd sat-reclaimer
pnpm install
cp .env.example .env.local     # every flag defaults to off
pnpm dev                       # http://localhost:3000      landing
                               # http://localhost:3000/app  reclaim console
```

Node 22 and `pnpm@10.17.1` (pinned via `packageManager`). The whole test suite is
offline: no network access and no Mainnet dependency.

## Before you open a pull request

```bash
pnpm verify    # lint && typecheck && test && build
```

All four must pass with exit code 0. If you changed anything under `src/lib`,
also run the large-wallet suite:

```bash
pnpm test:max  # adds the 10,000-UTXO plan (~2 minutes)
```

`pnpm test` runs 238 tests in roughly two minutes, most of it real PSBT
construction, signing, verification and finalization for wallets from 1 to 5,000
inputs. The 10,000-input plan is one long synchronous computation that trips
Vitest's 60-second worker heartbeat, which is why it has its own script instead of
being part of the default run. It is not skipped to hide anything — its measured
results are in [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md), and release
verification runs it.

## What a good change looks like

- **Tests first, for anything about transactions.** "Add tests before increasing
  supported batch sizes" is a project rule. If you make a sweep bigger, faster or
  cheaper, prove the invariants still hold at the new size.
- **Numbers come from the artifact.** If you display, log or compare a satoshi
  amount, a weight, a fee or a txid, derive it from the serialized PSBT or the raw
  bytes — not from the object that produced it and not from application state.
- **Fail closed.** An unexpected condition should throw a coded `ReclaimerError`
  and stop the flow. Never fall back to a "best effort" transaction.
- **New failure modes get new codes.** Add to the `ReclaimerErrorCode` union in
  `src/lib/errors.ts` rather than reusing a code that means something else.
- **Copy is part of the code.** This project has to be accurate about what it
  cannot do. Do not describe it as audited. Do not claim a confirmation you have
  not checked. Do not call a simulation a demo of a real transaction.
- **Presentation stays separate.** Nothing under `src/components/landing/` or
  `src/components/ui/` may import from `src/lib`, and no animation may sit between
  a user and a wallet confirmation or a transaction review.

## Workflow

- Branch from `master`; name it for the change (`fix/verifier-set-equality`,
  `feat/import-supported-wallet`, `docs/risk-disclosure`).
- Keep commits small and each one green. Do not mix a refactor with a fix.
- Open a pull request against `master` and fill in the template. CI must pass.
- Bitcoin-behaviour changes need the reasoning in the pull request, not just the
  diff: what could go wrong, and what happens when it does.

## Security-sensitive changes

Anything that touches the transaction lifecycle needs a second pair of eyes. Call
it out in the pull request and say which of these you changed:

`src/lib/sighash.ts`, `src/lib/psbt.ts`, `src/lib/verify.ts`,
`src/lib/broadcast.ts`, `src/lib/bitcoin.ts`, `src/lib/xverse.ts`, the
`BROADCAST_AUTHORISATION` wiring in `src/components/Reclaimer.tsx`.

If your change makes any of these easier, say so explicitly and expect the pull
request to be rejected:

- a transaction can be broadcast without a fresh per-txid authorization
- a partly verified PSBT can be finalized
- the fee can be lower than `vsize × fee rate`
- an input can appear twice
- a script-path spend can pass as a key-path spend
- the app can broadcast on a network that the operator flag has not enabled

## Licence

Contributions are accepted under the MIT licence in [`LICENSE`](LICENSE). By
opening a pull request you confirm you have the right to license your
contribution that way. Do not paste code from a project whose licence forbids it,
and do not add a dependency without checking its licence.
