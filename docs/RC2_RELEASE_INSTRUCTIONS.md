# RC2 owner release decision

**Prepared only. No tag or GitHub release is authorized.**

Review [`M10_BROWSER_ACCEPTANCE.md`](M10_BROWSER_ACCEPTANCE.md), the final merged
commit and its CI/CodeQL results, and [`RELEASE_GATES.md`](RELEASE_GATES.md).
Approve a **source-only prerelease for local use** explicitly before publication.
This does not authorize a hosted Mainnet service or close an external audit gate.

The final release packet outside the checkout records the exact merged SHA,
archive name and SHA-256 digest. An archive cannot include its own checksum or
commit SHA without changing them. Use the packet supplied with the final report,
not an earlier RC2 archive from M9.

## Owner decisions still required

- Approve or decline publishing `v0.1.0-rc.2` as a source-only local beta.
- Accept the disclosed synchronous large-planning stall, incomplete asset
  detection, in-memory session/attempt ledger, real-wallet evidence gaps and
  unverified Windows/macOS installations for this limited beta.
- Choose a non-GitHub security contact (E11) and decide the proposed local-first
  G7 scope change. Until artifacts/decisions exist, retain **NOT VERIFIED**.
- Keep A11/E7 open: an independent external Bitcoin audit is still required for
  unrestricted Mainnet launch. Internal tests and CodeQL do not satisfy it.

## After explicit approval only

1. Confirm a clean `master`, matching `origin/master`, with successful CI,
   production browser acceptance, large-wallet acceptance and CodeQL on that SHA.
   Confirm no open CodeQL alerts and rerun both secret scans before publishing.
2. Verify the packet's archive twice from the exact reviewed SHA:

   ```bash
   git archive --format=tar.gz --prefix=sat-reclaimer-0.1.0-rc.2/ REVIEWED_SHA > /tmp/rc2-check.tar.gz
   sha256sum /tmp/rc2-check.tar.gz
   ```

   Replace `REVIEWED_SHA` with the packet's full SHA and compare the recorded
   digest. The archive contains tracked source only, no dependency install,
   `.env.local`, browser fixture exports or production build.
3. Create the annotated `v0.1.0-rc.2` tag at that exact SHA and push that tag.
4. Create a **prerelease**, attach the reviewed archive and `.sha256` file, and
   use the packet's concise release body. Include the full source SHA and digest.
   Do not mark this as an audited release or a Mainnet readiness endorsement.
5. Verify the release assets, checksum, source links, prerelease flag and safe
   installation instructions. No hosted deployment accompanies this release.

## Installation from the reviewed source

Use Node 22+ and pnpm 10.17.1. Verify the archive checksum before extracting;
then run `pnpm install --frozen-lockfile`, `pnpm local:check`, and
`pnpm local --mode=plan`. Open the printed loopback `/app` URL. The default
production launcher disables Mainnet and all broadcasting. Signing always needs
wallet approval; broadcasting remains a separate deliberate action in enabled
modes. Stop with Ctrl+C.

Report defects privately through GitHub vulnerability reporting when security
sensitive. See [`SECURITY.md`](../SECURITY.md). No outside-GitHub contact is
invented by these instructions.
