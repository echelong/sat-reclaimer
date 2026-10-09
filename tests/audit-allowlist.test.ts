import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sat-reclaimer-audit-test-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function audit(report: unknown) {
  const path = join(root, 'audit.json');
  writeFileSync(path, JSON.stringify(report));
  return spawnSync(process.execPath, ['scripts/audit-allowlist.mjs', path], { encoding: 'utf8' });
}
const clean = { advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } };
it('accepts a complete audit with no known advisories', () => { expect(audit(clean).status).toBe(0); });
it.each([{}, { error: { message: 'registry unavailable' } }, { ...clean, advisories: [] }])('fails closed on an incomplete or error audit', (report) => {
  expect(audit(report).status).toBe(1);
});
it('rejects a new high-severity advisory', () => {
  const result = audit({ ...clean, advisories: { new: { severity: 'high', module_name: 'new-package', github_advisory_id: 'GHSA-new' } } });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('new-package');
});
it('rejects a vulnerability summary with missing advisory details', () => {
  expect(audit({ ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, high: 1 } } }).status).toBe(1);
});
