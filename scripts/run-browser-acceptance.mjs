// Rebuild each launcher mode, exercise it in an isolated fixture browser, and
// shut it down. Mainnet is never enabled; every external request is intercepted.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port = process.env.QA_PORT || '33217';
const parent = resolve(process.env.QA_OUTPUT || tmpdir());
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'sat-reclaimer-browser-'));
let server;
let log;
async function stop() {
  if (!server || server.exitCode !== null) return;
  const closed = new Promise(resolve => server.once('close', resolve));
  server.kill('SIGTERM');
  await closed;
  await log?.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().then(() => process.exit(1)); });
async function launch(mode) {
  log = await open(`${output}/launcher-${mode}.log`, 'w');
  server = spawn(process.execPath, ['scripts/start-local.mjs', `--mode=${mode}`], {
    env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Production launcher readiness timed out')), 180000);
    let recent = '';
    server.stdout.on('data', chunk => {
      void log.write(chunk);
      recent = (recent + chunk).slice(-2000);
      if (recent.includes('Ready in')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', chunk => { void log.write(chunk); });
    server.once('error', e => { clearTimeout(timer); reject(e); });
    server.once('close', code => { clearTimeout(timer); reject(new Error(`Launcher exited ${code}; see launcher-${mode}.log`)); });
  });
}
async function qa(kind, flags = {}) {
  await mkdir(`${output}/${kind}`, { mode: 0o700 });
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/browser-acceptance.mjs'], {
      env: { ...process.env, QA_SCALE: 'false', QA_BROADCAST: 'false', QA_ORIGIN: `http://127.0.0.1:${port}`, QA_OUTPUT: `${output}/${kind}`, ...flags }, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${kind} browser QA exited ${code}`)));
  });
}
try {
  await launch('plan');
  await qa('plan');
  if (process.argv.includes('--scale')) await qa('scale', { QA_SCALE: 'true' });
  await stop();
  await launch('testnet');
  await qa('testnet', { QA_BROADCAST: 'true' });
} finally {
  await stop();
}
console.log(`Production browser acceptance passed. Evidence: ${output}`);
