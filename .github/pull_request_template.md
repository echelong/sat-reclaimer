<!--
  No AI assistant attribution, and no Co-authored-by trailers for tools.
  Commits are attributed to the person who wrote them.
-->

## Summary

What changes, and why. Name the behaviour, not the file list.

## Type of change

- [ ] Bug fix (a confirmed defect)
- [ ] Security hardening (closes a gap that was not necessarily exploitable)
- [ ] Feature
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Tooling / CI

## Testing evidence

Paste the commands and the real results. Do not write "tests pass".

```
pnpm lint        # exit
pnpm typecheck   # exit
pnpm test        # N passed, exit
pnpm build       # exit
pnpm test:max    # only if anything under src/lib or tests/ changed
```

If this changes a guard, show the test that fails **without** the change. If a
guard was removed, that needs its own paragraph explaining why the invariant is
still enforced somewhere else.

## Bitcoin safety impact

Answer each one. "No" is fine and expected for most changes.

| Question | Answer |
| --- | --- |
| Can this make a transaction broadcast without a fresh per-txid authorization? | |
| Can a partly verified PSBT now be finalized, or a failed verification become broadcastable bytes? | |
| Can an input appear twice, or an expected input be dropped? | |
| Can the fee be lower than `vsize × fee rate`? | |
| Can a script-path spend pass as a key-path spend? | |
| Can a Mainnet transaction be built or broadcast while a flag is off? | |
| Does anything now request, store, log or transmit key material? | |
| Does the verifier read any value the builder computed, instead of re-deriving it from the artifact? | |
| Does anything retry, resubmit or sign a replacement automatically? | |

Which lifecycle stage does this touch: CONNECT / SCAN / SELECT / BUILD / REVIEW /
SIGN / VERIFY / BROADCAST / CONFIRM?

## Security considerations

What could this change make easier to get wrong? What untrusted input (indexer
data, wallet response, node response, user input) has a new path into the code?
If this touches `src/lib/verify.ts`, `src/lib/psbt.ts`, `src/lib/sighash.ts` or
`src/lib/broadcast.ts`, say what you checked by hand as well as by test.

## UI impact

Screenshots at 1440 px and 390 px if any user-visible surface changed. Confirm:

- [ ] Keyboard reachable, with a visible focus ring on every new control
- [ ] Works with `prefers-reduced-motion: reduce` and reaches its final state
- [ ] No new claim that the software is audited, that an asset is safe, or that a
      broadcast is confirmed without checking
- [ ] Gross input sats are never presented as recovered bitcoin
- [ ] No new dependency, or the dependency and its licence are named here

## Checklist

- [ ] Every commit builds and passes on its own
- [ ] `pnpm verify` passes locally with exit code 0
- [ ] New behaviour has tests; new failure modes have a `ReclaimerErrorCode`
- [ ] Documentation updated (`README.md`, `docs/`, `CLAUDE.md` if a rule changed)
- [ ] No secrets, no real wallet addresses that are not already public on chain,
      no `.env.local`, no build artefact
- [ ] I have the right to license this contribution under the MIT licence
