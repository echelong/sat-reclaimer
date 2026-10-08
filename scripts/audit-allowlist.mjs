#!/usr/bin/env node
/**
 * Fail on any high or critical dependency advisory that is not a documented,
 * reviewed exception.
 *
 * `pnpm audit --prod --audit-level=high` is the primary gate: it resolves the tree
 * that actually ships. This script covers the rest of the tree, so a new advisory
 * in build or test tooling still stops the build instead of scrolling past in a
 * log nobody reads.
 *
 * An entry may only be added to ALLOWED when all three of these are true, and the
 * reason field has to say so:
 *
 *   1. the package is reachable only from development tooling, never from the
 *      application bundle or anything that runs in a user's browser;
 *   2. there is no patched release to move to — not "we did not get round to it";
 *   3. the exposure is written down, not assumed.
 *
 * Adding a name here to make a build go green is exactly the failure this file
 * exists to prevent. If a fix exists, take the fix.
 *
 * Usage: node scripts/audit-allowlist.mjs audit.json
 */
import { readFileSync } from 'node:fs';

const ALLOWED = [
  {
    module: 'braces',
    advisory: 'GHSA-vfj7-8cjw-p6xm',
    reason:
      'Reachable only from the ESLint config glob chain ' +
      '(eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch > ' +
      'braces), so it never enters the application bundle and only ever parses ' +
      'patterns this repository authors itself. braces 3.0.3 is the newest ' +
      'release and the advisory lists no patched version, so there is nothing to ' +
      'upgrade to. Remove this entry as soon as micromatch ships a fixed braces.',
  },
];

const path = process.argv[2] ?? 'audit.json';

let report;
try {
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`could not read the audit report at ${path}: ${error.message}`);
  process.exit(1);
}

const advisories = Object.values(report.advisories ?? {});
const blocking = advisories.filter((a) => a.severity === 'high' || a.severity === 'critical');

const exceptionFor = (advisory) =>
  ALLOWED.find(
    (entry) => entry.module === advisory.module_name && entry.advisory === advisory.github_advisory_id,
  );

const waived = blocking.filter((a) => exceptionFor(a));
const failing = blocking.filter((a) => !exceptionFor(a));

for (const advisory of waived) {
  console.log(
    `waived: ${advisory.severity} ${advisory.module_name} (${advisory.github_advisory_id}) — ` +
      exceptionFor(advisory).reason,
  );
}

for (const advisory of advisories) {
  if (advisory.severity === 'high' || advisory.severity === 'critical') continue;
  console.log(
    `reported (not blocking): ${advisory.severity} ${advisory.module_name} ${advisory.vulnerable_versions}`,
  );
}

if (failing.length > 0) {
  console.error('');
  console.error('FAIL: high or critical advisories that are not allowlisted:');
  for (const a of failing) {
    console.error(
      `  - ${a.severity} ${a.module_name} ${a.vulnerable_versions} ` +
        `(patched: ${a.patched_versions}) ${a.url}`,
    );
  }
  console.error('');
  console.error('Fix the dependency. Only a dev-only, unfixable advisory may be added to');
  console.error('ALLOWED in this script, and the reason has to explain both.');
  process.exit(1);
}

console.log(
  `ok: ${blocking.length} high/critical advisor${blocking.length === 1 ? 'y' : 'ies'}, ` +
    `all allowlisted`,
);
