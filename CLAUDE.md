# Development guidance

Primary goal: prove a safe, non-custodial Taproot inscription-UTXO reclaim flow
before expanding product scope.

Use the main session as coordinator. Delegate independent protocol research,
test-vector construction, UI work, and security review when that reduces
coupling; the main session must verify all merged results.

Hard rules:

- Never request, persist, log, or transmit a seed phrase/private key.
- Mainnet is disabled by default. It may be enabled only by an explicit operator
  flag (`NEXT_PUBLIC_ENABLE_MAINNET=true`) for the Sweep All workflow; never as a
  default, a silent fallback, or by treating Mainnet as a test chain. See
  `docs/ARCHITECTURE.md` M5.
- Signing and broadcasting remain separate operations: signing never broadcasts,
  and broadcasting is a separate manual action authorized for one exact verified
  txid.
- Mainnet broadcasting requires a second explicit operator flag
  (`NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST=true`) on top of
  `NEXT_PUBLIC_ENABLE_MAINNET=true`. Never resubmit automatically after an
  ambiguous network response, and never sign a replacement on the app's
  initiative.
- Every transaction must be decoded and invariant-checked independently of the
  code that built it.
- Deduplicate inputs by `txid:vout`.
- Never infer asset safety from inscription count alone.
- Avoid adding app/server custody infrastructure.
- Add tests before increasing supported batch sizes.
- Keep presentation separate from the engine. The landing page, the animated hero
  and the simulated demo must not import from `src/lib`, and no motion effect may
  ever sit between a user and a wallet confirmation or a transaction review.
  Public marketing copy must not claim an audit, a confirmation, or a recovery
  that has not been verified on chain.
- No AI attribution anywhere: no `Co-authored-by` trailers, no "generated with"
  lines in commits, and no assistant branding in the README or docs.
- The local service binds to `127.0.0.1` only. Never expose Mainnet functionality
  on a network-reachable or publicly accessible server, and never make the
  hostname configurable so that it can be.

## Before any public release

Read [`docs/RELEASE_GATES.md`](docs/RELEASE_GATES.md). It is the single source of
truth for what is proven and what is not, with PASS / FAIL / NOT VERIFIED per
gate and the evidence behind each. An internal code review is not an independent
external security audit, so gate A11/E7 stay **NOT VERIFIED** and unrestricted
public Mainnet launch stays blocked until a third party reviews it.

Do not deploy an unrestricted public Mainnet interface, and do not enable
Mainnet broadcasting in any public deployment, while those gates are open.

## Current priority

M5 — public local release readiness. The repository is published under MIT at
`github.com/echelong/sat-reclaimer` and is distributed as a **locally runnable**
app: clone it, run `pnpm local`, connect Xverse. There is no hosted site, no
domain and no account, and none is wanted. The remaining work is the verification
that cannot be done from this machine:

1. A live Xverse acceptance run on this version, following
   `docs/MANUAL_ACCEPTANCE.md` (connect/disconnect, network switching, full scans,
   large-payload signing, cancellation, signing/verification, import/export
   recovery, broadcast status). The wallet's real PSBT payload limit is unproven —
   `docs/RELEASE_GATES.md` gate B6 — and only that run can close it.
2. An independent external security review (gate A11/E7);
   `docs/AUDIT_HANDOFF.md` is the brief for that reviewer, **not** the review.
3. A security contact **outside GitHub** — an email address or PGP key (gate E11,
   pending owner input). GitHub private reporting is itself enabled and verified
   (gate E8).
4. Windows and macOS install verification (gates K9/K10). Only Linux is verified.

`docs/RELEASE_NOTES_v0.1.0-rc.1.md` is prepared and **not published**: do not tag
it or create a GitHub release while the items above are open, and do not deploy a
hosted site — distribution is the repository itself.

When a mainnet sweep is authorized again, reuse the exact verified transaction if
it still exists; otherwise rebuild only after confirming the previous txid is
unknown and its inputs are unspent. Broadcast manually through independent nodes,
compare the returned txid, and track confirmation.

## Useful entry points

- `pnpm local` — start the app locally, bound to `127.0.0.1`; the default mode
  cannot spend anything (`scripts/start-local.mjs`, `docs/LOCAL_SETUP.md`).
- `pnpm local:check` — read-only environment check; installs nothing.
- `pnpm verify` — lint, typecheck, test and build in one command.
- `pnpm test:max` — the 10,000-UTXO scale run (`docs/PERFORMANCE.md`).
- `./scripts/scan-secrets.sh` — full-history secret scan; `--tree` for the
  working tree. Both must exit 0 before any push.
