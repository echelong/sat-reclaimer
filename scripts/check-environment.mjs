#!/usr/bin/env node
/**
 * Check that this machine can run SAT//RECLAIMER locally, and say exactly what
 * to do about anything that is missing.
 *
 * It only looks and reports. It installs nothing, downloads nothing, changes
 * nothing, and never asks for elevated privileges — a check that modifies your
 * machine is not a check. The install commands it prints are the ordinary
 * package-manager commands for your platform, for you to run yourself.
 *
 * Usage: node scripts/check-environment.mjs     (or: pnpm local:check)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MIN_NODE_MAJOR = 22;

const ok = (s) => `\u001b[32m${s}\u001b[0m`;
const bad = (s) => `\u001b[31m${s}\u001b[0m`;
const warn = (s) => `\u001b[33m${s}\u001b[0m`;

const platform = process.platform;
const platformName =
  platform === 'linux' ? 'Linux' : platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform;

/** The ordinary install command for each tool, per platform. */
function installHint(tool) {
  const nodeName = tool === 'node' ? 'Node.js' : 'pnpm';
  if (platform === 'darwin') {
    return [
      `  macOS (Homebrew):      brew install ${tool === 'node' ? 'node@22' : 'pnpm'}`,
      '  or download the installer from https://nodejs.org/en/download',
    ].join('\n');
  }
  if (platform === 'win32') {
    return [
      `  Windows (winget):      winget install ${tool === 'node' ? 'OpenJS.NodeJS.LTS' : 'pnpm.pnpm'}`,
      '  or download the LTS installer from https://nodejs.org/en/download',
      '  (no administrator shell is required unless you deliberately install machine-wide)',
    ].join('\n');
  }
  return [
    `  Fedora / RHEL:         sudo dnf install ${tool === 'node' ? 'nodejs22' : 'nodejs22-npm'}`,
    `  Debian / Ubuntu:       sudo apt install ${tool === 'node' ? 'nodejs npm' : 'npm'}`,
    `  Arch:                  sudo pacman -S ${nodeName === 'Node.js' ? 'nodejs npm' : 'pnpm'}`,
    '  Any distro, no root:   https://nodejs.org/en/download (a tarball you can unpack in $HOME)',
    '  Then enable pnpm:      corepack enable   (corepack ships with Node)',
  ].join('\n');
}

const problems = [];
const notes = [];

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= MIN_NODE_MAJOR) {
  console.log(`${ok('ok')}    Node.js v${process.versions.node} (needs ${MIN_NODE_MAJOR} or newer)`);
} else {
  console.log(`${bad('FAIL')}  Node.js v${process.versions.node} is too old (needs ${MIN_NODE_MAJOR} or newer)`);
  problems.push(`Install a supported Node.js LTS release.\n${installHint('node')}`);
}
if (nodeMajor % 2 === 1) {
  notes.push(
    `Node ${nodeMajor} is an odd (non-LTS) release line. It works, but an even-numbered LTS ` +
      'release is the better choice for running this for real.',
  );
}

const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: platform === 'win32' });
if (pnpm.status === 0) {
  console.log(`${ok('ok')}    pnpm ${pnpm.stdout.trim()}`);
} else {
  console.log(`${bad('FAIL')}  pnpm was not found on PATH`);
  problems.push(`Install pnpm.\n${installHint('pnpm')}`);
}

// Read the pinned version so the message matches the repository rather than a guess.
let pinnedManager = null;
try {
  pinnedManager = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager ?? null;
} catch {
  // A missing or unreadable package.json is reported by the dependency check below.
}
if (pinnedManager && pnpm.status === 0 && !pinnedManager.endsWith(pnpm.stdout.trim())) {
  notes.push(
    `This repository pins ${pinnedManager}. Yours is ${pnpm.stdout.trim()}. ` +
      'Run `corepack enable` in the repository to use the pinned version automatically.',
  );
}

if (existsSync(join(root, 'node_modules'))) {
  console.log(`${ok('ok')}    dependencies are installed (node_modules exists)`);
} else {
  console.log(`${warn('note')}  dependencies are not installed yet`);
  notes.push('Run `pnpm install` in the repository directory.');
}

console.log('');
console.log(`Platform: ${platformName} (${process.arch})`);
for (const note of notes) console.log(`  ${warn('note')} ${note}`);

if (problems.length > 0) {
  console.log('');
  for (const problem of problems) console.log(`${bad('problem')} ${problem}`);
  console.log('');
  console.log('Fix the items above, then run this check again.');
  process.exit(1);
}

console.log('');
console.log(`${ok('This machine is ready.')} Start the app with:  pnpm local`);
