# M9 local validation — Rio, 2026-10-09

This is internal engineering evidence, not an independent Bitcoin audit or live
wallet acceptance. No real-money signing, broadcasting or transaction lookup was
performed. The owner reports the newer transaction was in the mempool and asked
for no lookup; its TXID and network remain unrecorded.

## Baseline and scope

- Starting checkout: `28bde14d9e7496beddfa677b9b5069b22622e88c` on the existing
  temporary `m9/reliability-and-hygiene` branch; clean working tree, open PR #7.
- Starting local and remote `master`: `89bd13d`; fetched before comparing. The
  temporary branch was two commits ahead, with test-timeout and generated-file
  changes. `next-env.d.ts` was still tracked; this continuation actually removes
  it from the index.
- Platform: Fedora 44 x86_64, Node 24.20.0, pnpm 10.17.1. The older Fedora 43 /
  Node 22 evidence is historical and was not silently reused as this run.
- Exact runtime dependency pins and `pnpm-lock.yaml` were retained. Package source
  version advances to `0.1.0-rc.2`; no dependency resolution change is required.

## Actual command results

| Check | Exit/result | Scope |
| --- | --- | --- |
| Baseline frozen install and `pnpm local:check` | 0 | Rio existing checkout |
| Baseline `pnpm verify` | 0; 243 passed, 1 skipped, 10 files | Initial test process; later edits independently tested below |
| Initial `pnpm test:max` | 0; 7/7, 482.98 s | Ran concurrently with baseline suite; not isolated timing |
| Separate full scale run | 0; 7/7, 466.67 s | Synthetic inputs; real signing/verification through 5,000, planning through 10,000 |
| Final `pnpm verify` | 0; 299 passed, 1 skipped, 14 files; tests 427.78 s | Lint, typecheck and production build also exit 0; all three product flags explicitly false |
| Final corrected 10,000-input reporting | 0; 1 passed, 6 filtered out, 120.33 s | Plan 119,975 ms; six batches, max 395,822 WU; base64 PSBT 1,602.1 KiB; RSS 301.8 MB; raw bytes unmeasured |
| Production dependency audit | 0; no known vulnerabilities | Fresh registry response, `pnpm audit --prod --audit-level=high` |
| Full dependency audit gate | 0; one documented exception | Fresh JSON; high `braces` GHSA-vfj7-8cjw-p6xm, dev-only; no new waiver |
| Secret scans, history and tree | 0 / 0 | No key/credential patterns or unsafe committed configuration |
| `git diff --check` | 0 | No whitespace errors |

The final packaging follow-up adds eight safe-artifact cases and reruns the ten
console-handler cases, lint, typecheck and production build. CI now checks the
rendered console flags and disabled Mainnet option, rather than merely printing
the build environment. These public markers are build evidence, not an
authorization boundary.

The full audit tool itself now fails on missing/error reports rather than treating
an unavailable registry as an empty advisory set. Dedicated tests exercise that
failure, a new high advisory, missing advisory details and a complete clean report.

## Clean source installation and real launcher lifecycle

A fresh source archive of engineering commit `045ea65` was extracted into a new
temporary directory, without `.env.local`, `node_modules`, generated declarations
or `.next`. Commands and observed exits:

1. `pnpm install --frozen-lockfile`: **0**, 401 packages installed, 3.4 s. pnpm
   reported ignored dependency build scripts (`esbuild`, `unrs-resolver`); no
   blanket build-script approval was given, and typecheck/build/start succeeded.
2. `pnpm local:check`: **0**, correct Node/pnpm/Linux architecture reported.
3. `pnpm typecheck` before a build generated declarations: **0**.
4. `PORT=3188 node scripts/start-local.mjs --mode=plan`: production build succeeds;
   `/app` **HTTP 200**, Mainnet locked, socket **only `127.0.0.1:3188`**.
5. An additional `--dev` launcher on the occupied port: **1**, `EADDRINUSE`, clear
   troubleshooting message; no alternate network binding or silent port change.
6. SIGINT sent to the owned launcher: **130**, server socket gone afterward.

The repository checkout was also served on `127.0.0.1:3187`: landing and console
**HTTP 200**, unknown path **404**. `/app` had CSP, frame denial, nosniff,
permissions policy and `Cache-Control: no-store, must-revalidate`. HTTP inspection
confirmed Mainnet locked. The earlier direct SIGTERM to the child returned **143**;
the clean-run SIGINT above exercises the launcher's real signal-forwarding path.

Launcher subprocess regressions verify production default, overriding inherited
enabled flags, explicit development mode, loopback binding, invalid modes/options
and ports, build-failure exit propagation, and SIGTERM cleanup. Production rebuilds
every launch because public flags are baked into the client bundle.

## Transaction-session regressions

- Fractional mining rates cannot be silently rounded.
- An unsigned payload fallback preserves the exact outpoint set, destination and
  rate, measures its new fee, and requires fresh signing acknowledgement.
- Any earlier signing report prevents repartitioning; verified raw bytes survive.
- Cancellation or timeout is not reinterpreted as a size rejection.
- Ambiguous broadcast responses cause independent GET lookups, never a second
  POST to a fallback endpoint. Attempted txids remain recorded after timeout,
  HTTP 503, rejection or returned-txid mismatch; repeated submission is refused.
  Native batches cannot be re-signed after submission was attempted. Both normal
  and imported transactions expose read-only confirmation checks.
- Network changes and failed rescan/disconnect clear stale wallet state.
- Two connect clicks before a React render cause one provider request.
- Individual output selection drives the actual plan; editing a rate removes an
  unsigned review. Signed plans lock selection, destination and rate.
- A recovery handler cannot submit without current explicit approval; editing
  bytes clears its prior inspection and approval. Network changes remount recovery.
- Unknown, invalid, contradictory and changing provider totals cannot produce a
  falsely complete scan. Page progress counts unique retrieved inscriptions.

## Evidence limits and release decision

Browser automation exposes no available browser in this session; opening the
in-app browser failed with `Browser is not available: iab`. No visual, responsive,
keyboard or real-Xverse acceptance is claimed for this candidate. UI handlers are
exercised with a deterministic hook store; these tests do not render a DOM or
approve in a wallet. Historical browser screenshots and gate evidence remain
explicitly historical. New output controls preserve existing styles and have
100-output pagination and a bounded scrolling area.

The release-gate table was counted directly: **94 gates, 80 PASS (85.1%),
14 NOT VERIFIED (14.9%), 0 FAIL**. No manual or external gate was promoted.
Manual acceptance remains **9/9 operator-reported, 0/9 formally verified**.
The external audit, real provider limit, live wallet artifacts, outside-GitHub
security contact, Windows/macOS checks and staging scope decision remain open.

[`RELEASE_NOTES_v0.1.0-rc.2.md`](RELEASE_NOTES_v0.1.0-rc.2.md) is prepared for
owner review. No tag or release is published. PR #7 is the integration path;
required CI and CodeQL must pass before merging, then the temporary branch is
removed. Final integration SHA, source archive checksum and CI results are reported
after integration, avoiding a self-referential checksum committed into its source.
