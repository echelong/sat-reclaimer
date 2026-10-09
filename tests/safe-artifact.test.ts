import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sat-reclaimer-artifact-test-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const safe = '<main id="console" data-mainnet-enabled="false" data-mainnet-broadcast-enabled="false" data-signet-broadcast-enabled="false"><option value="Mainnet" disabled="">Mainnet (locked in code)</option></main>';
function check(html?: string) {
  const path = join(root, 'app.html');
  if (html !== undefined) writeFileSync(path, html);
  return spawnSync(process.execPath, ['scripts/check-safe-artifact.mjs', path], { encoding: 'utf8' });
}
it('accepts the rendered safe console', () => { expect(check(safe).status).toBe(0); });
it.each(['mainnet', 'mainnet-broadcast', 'signet-broadcast'])('refuses an enabled rendered %s flag', (flag) => {
  expect(check(safe.replace(`data-${flag}-enabled="false"`, `data-${flag}-enabled="true"`)).status).toBe(1);
});
it.each([undefined, '', safe.replace('data-mainnet-enabled="false"', ''), safe.replace(' disabled=""', '')])('fails closed when the artifact or lock is missing', (html) => {
  expect(check(html).status).toBe(1);
});
