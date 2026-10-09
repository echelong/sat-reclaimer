import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sat-reclaimer-launcher-test-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'node_modules/next/dist/bin'), { recursive: true });
  copyFileSync('scripts/start-local.mjs', join(root, 'scripts/start-local.mjs'));
  writeFileSync(join(root, 'node_modules/next/dist/bin/next'), `
    const fs = require('node:fs');
    fs.appendFileSync(process.env.CAPTURE_PATH, JSON.stringify({ args: process.argv.slice(2), pid: process.pid,
      flags: [process.env.NEXT_PUBLIC_ENABLE_MAINNET, process.env.NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST,
      process.env.NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST] }) + '\\n');
    if (process.argv[2] === 'build') process.exit(Number(process.env.BUILD_STATUS || 0));
    if (process.env.HOLD_SERVER === 'true') { console.log('TEST_SERVER_READY'); setInterval(() => {}, 1000); }
  `);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function environment(extra: Record<string, string> = {}) {
  return { ...process.env, CAPTURE_PATH: join(root, 'calls.jsonl'), PORT: '3000',
    NEXT_PUBLIC_ENABLE_MAINNET: 'true', NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST: 'true',
    NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST: 'true', ...extra };
}
function run(args: string[] = [], extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts/start-local.mjs'), ...args], { env: environment(extra), encoding: 'utf8' });
}
function calls() {
  return readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

describe('production local launcher', () => {
  it('defaults to production and overrides inherited unsafe flags with all flags off', () => {
    expect(run().status).toBe(0);
    expect(calls().map((call) => call.args)).toEqual([['build'], ['start', '-H', '127.0.0.1', '-p', '3000']]);
    for (const call of calls()) expect(call.flags).toEqual(['false', 'false', 'false']);
  });
  it('allows an explicit development server with the same loopback binding', () => {
    expect(run(['--mode=plan', '--dev']).status).toBe(0);
    expect(calls()[0].args).toEqual(['dev', '-H', '127.0.0.1', '-p', '3000']);
  });
  it.each([['--mode=broadcast'], ['--mode=unknown'], ['--hostname=0.0.0.0']])('refuses unsafe or invalid arguments %s', (...args) => {
    expect(run(args).status).toBe(2);
  });
  it.each(['0', '65536', '3000; echo unsafe', 'NaN'])('refuses invalid port %s before building', (port) => {
    expect(run(['--mode=plan'], { PORT: port }).status).toBe(2);
  });
  it('does not start after a build failure and preserves the exit code', () => {
    expect(run(['--mode=plan'], { BUILD_STATUS: '42' }).status).toBe(42);
    expect(calls()).toHaveLength(1);
  });
  it('forwards SIGTERM to its server and exits 143 without leaving the server alive', async () => {
    const child = spawn(process.execPath, [join(root, 'scripts/start-local.mjs'), '--mode=plan', '--dev'], {
      env: environment({ HOLD_SERVER: 'true' }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (data) => { if (String(data).includes('TEST_SERVER_READY')) resolve(); });
        child.once('error', reject);
      });
      const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
      child.kill('SIGTERM');
      expect(await closed).toBe(143);
      expect(() => process.kill(calls()[0].pid, 0)).toThrow();
    } finally { if (child.exitCode === null) child.kill('SIGTERM'); }
  });
});
