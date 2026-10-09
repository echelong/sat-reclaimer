#!/usr/bin/env node
/**
 * Start SAT//RECLAIMER locally, bound to this machine only.
 *
 * Why this exists rather than `next dev`: the network and broadcast flags are
 * build-time `NEXT_PUBLIC_*` values, so a local user would otherwise have to hand
 * -edit a dotfile before they could even look at the app. This launcher makes the
 * choice explicit and audible — it prints exactly what it is about to enable, and
 * refuses to enable Mainnet broadcasting without a typed confirmation.
 *
 * It binds to 127.0.0.1 and never to a public interface, so nothing here is
 * reachable from your network even while it is running. That is the reason the
 * hostname is not configurable.
 *
 * Remember what these flags are: product policy, not a security boundary. They
 * decide what the app offers to do. The thing that actually protects your bitcoin
 * is that your wallet approves one exact transaction and this app verifies the
 * signed bytes before anything else can happen.
 *
 * Usage:
 *   pnpm local                      interactive
 *   pnpm local --mode=plan          connect, scan, review; nothing can be spent
 *   pnpm local --mode=testnet       Signet/Testnet, broadcasting allowed
 *   pnpm local --mode=mainnet       Mainnet building and signing; no broadcast
 *   pnpm local --mode=broadcast     Mainnet with broadcasting (types a phrase)
 *   pnpm local --mode=plan --prod   production build (the default)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST = '127.0.0.1';
const PORT = process.env.PORT ?? '3000';

const MODES = {
  plan: {
    title: 'Look and plan only',
    detail: [
      'Mainnet is disabled. Signet/Testnet can be scanned, planned, signed and verified.',
      'Nothing can be broadcast on any chain.',
    ],
    flags: { mainnet: false, testnetBroadcast: false, mainnetBroadcast: false },
  },
  testnet: {
    title: 'Signet / Testnet',
    detail: [
      'Signet/Testnet broadcasting is enabled. These coins have no monetary value.',
      'Mainnet stays disabled.',
    ],
    flags: { mainnet: false, testnetBroadcast: true, mainnetBroadcast: false },
  },
  mainnet: {
    title: 'Mainnet, building and signing only',
    detail: [
      'Mainnet is enabled: real BTC can be scanned, planned, signed and verified.',
      'Broadcasting stays DISABLED, so nothing can be sent to the network from here.',
    ],
    flags: { mainnet: true, testnetBroadcast: false, mainnetBroadcast: false },
  },
  broadcast: {
    title: 'Mainnet WITH broadcasting — real bitcoin can move',
    detail: [
      'Everything in the Mainnet mode, plus the ability to broadcast a verified transaction.',
      'Every broadcast still needs your explicit per-transaction authorization.',
    ],
    flags: { mainnet: true, testnetBroadcast: false, mainnetBroadcast: true },
  },
};

const CONFIRM_PHRASE = 'I UNDERSTAND REAL BITCOIN CAN MOVE';

function parseArgs(argv) {
  const options = { mode: null, prod: true, confirm: false };
  for (const arg of argv) {
    if (arg === '--prod' || arg === '--production') options.prod = true;
    else if (arg === '--dev') options.prod = false;
    else if (arg === '--confirm-real-btc') options.confirm = true;
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

function helpText() {
  return [
    'Start SAT//RECLAIMER locally on this machine only.',
    '',
    '  pnpm local                    ask which mode to run in',
    '  pnpm local --mode=plan        nothing can be spent',
    '  pnpm local --mode=testnet     Signet/Testnet, broadcasting allowed',
    '  pnpm local --mode=mainnet     Mainnet building and signing, no broadcast',
    '  pnpm local --mode=broadcast   Mainnet with broadcasting',
    '  pnpm local --mode=plan --prod production build (default)',
    '  pnpm local --mode=plan --dev  development server for contributors',
    '',
    'The server binds to 127.0.0.1 and is never reachable from your network.',
    'Set PORT to change the port (default 3000).',
  ].join('\n');
}

if (options.help) {
  console.log(helpText());
  process.exit(0);
}

// Invoke the installed Next CLI through Node, avoiding package-manager shell shims.
let currentChild = null;
let stopSignal = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopSignal = signal;
    if (!currentChild) process.exit(signal === 'SIGINT' ? 130 : 143);
    if (process.platform === 'win32') currentChild.kill(signal);
    else {
      try { process.kill(-currentChild.pid, signal); } catch (error) {
        if (error.code !== 'ESRCH') console.error(`Could not stop the server: ${error.message}`);
      }
    }
  });
}

async function runNext(args, env) {
  let cli;
  try {
    cli = createRequire(import.meta.url).resolve('next/dist/bin/next');
  } catch {
    console.error('Next.js is not installed. Run `pnpm install --frozen-lockfile`.');
    return 1;
  }
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32',
    });
    currentChild = child;
    child.on('error', (error) => {
      console.error(`Could not start Next.js: ${error.message}`);
      currentChild = null;
      resolve(1);
    });
    child.on('close', (code, signal) => {
      currentChild = null;
      resolve(stopSignal === 'SIGINT' || signal === 'SIGINT' ? 130
        : stopSignal === 'SIGTERM' || signal === 'SIGTERM' ? 143 : code ?? 1);
    });
  });
}

if (options.mode && !MODES[options.mode]) {
  console.error(`Unknown mode: ${options.mode}. Expected one of: ${Object.keys(MODES).join(', ')}`);
  process.exit(2);
}

// Refuse to be a hidden way to enable real-money broadcasting in a script.
if (options.mode === 'broadcast' && !options.confirm) {
  console.error('');
  console.error('Refusing to start: --mode=broadcast needs --confirm-real-btc as well.');
  console.error('');
  console.error('That flag exists so that enabling Mainnet broadcasting is always a');
  console.error('deliberate, visible act — in a shell history, in a script, or in a chat —');
  console.error('and never something a copy-pasted command does by accident.');
  console.error('');
  console.error('  pnpm local --mode=broadcast --confirm-real-btc');
  console.error('');
  process.exit(2);
}

const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const red = (s) => `\u001b[31m${s}\u001b[0m`;
const yellow = (s) => `\u001b[33m${s}\u001b[0m`;

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

async function chooseMode() {
  console.log('');
  console.log(bold('  SAT//RECLAIMER — local launcher'));
  console.log(dim('  Binds to 127.0.0.1 only. No account, no server, no platform fee.'));
  console.log('');
  const order = ['plan', 'testnet', 'mainnet', 'broadcast'];
  order.forEach((key, index) => {
    const mode = MODES[key];
    const marker = key === 'plan' ? dim(' (default — press Enter)') : '';
    console.log(`  ${index + 1}. ${bold(mode.title)}${marker}`);
    for (const line of mode.detail) console.log(`     ${dim(line)}`);
    console.log('');
  });
  const answer = (await ask('  Choose 1-4: ')).trim();
  if (answer === '') return 'plan';
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= order.length) return order[index - 1];
  const named = order.find((key) => key === answer.toLowerCase());
  if (named) return named;
  console.log(`  ${yellow('Not a valid choice; starting in the default mode.')}`);
  return 'plan';
}

async function confirmRealBtc() {
  console.log('');
  console.log(red('  Mainnet broadcasting can move real bitcoin. There is no undo, no'));
  console.log(red('  refund and no support process. Inscriptions, runes and rare sats that'));
  console.log(red('  ride on the outputs you select will move with them.'));
  console.log('');
  const answer = (await ask(`  Type "${bold(CONFIRM_PHRASE)}" to continue: `)).trim();
  if (answer !== CONFIRM_PHRASE) {
    console.log('');
    console.log('  Phrase did not match. Not starting in broadcast mode.');
    console.log(`  ${dim('Run `pnpm local --mode=mainnet` to build and sign without broadcasting.')}`);
    process.exit(1);
  }
}

async function main() {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let mode = options.mode;
  if (!mode) {
    if (!interactive) {
      console.log('No --mode given and not attached to a terminal; starting in "plan" mode.');
      console.log('That default is intentional: the safe choice is the one you get by accident.');
      mode = 'plan';
    } else {
      mode = await chooseMode();
    }
  }
  if (mode === 'broadcast' && interactive) await confirmRealBtc();

  if (!/^\d+$/.test(PORT) || Number(PORT) < 1 || Number(PORT) > 65535) {
    console.error('PORT must be an integer between 1 and 65535. Nothing was started.');
    process.exit(2);
  }
  const chosen = MODES[mode];
  const env = {
    ...process.env,
    NEXT_PUBLIC_ENABLE_MAINNET: chosen.flags.mainnet ? 'true' : 'false',
    NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST: chosen.flags.testnetBroadcast ? 'true' : 'false',
    NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST: chosen.flags.mainnetBroadcast ? 'true' : 'false',
  };

  console.log('');
  console.log(bold('  About to start'));
  console.log(`  mode          ${chosen.title}`);
  console.log(`  mainnet       ${chosen.flags.mainnet ? red('ENABLED') : 'disabled'}`);
  console.log(`  testnet bcast ${chosen.flags.testnetBroadcast ? yellow('enabled') : 'disabled'}`);
  console.log(`  mainnet bcast ${chosen.flags.mainnetBroadcast ? red('ENABLED') : 'disabled'}`);
  console.log(`  serving       ${options.prod ? 'production build' : 'development server'} on http://${HOST}:${PORT}`);
  console.log(`  reachable     ${HOST} only — not from your network`);
  console.log('');
  console.log(dim('  These flags are product policy, not a security boundary. Your wallet'));
  console.log(dim('  approves one exact transaction, and this app verifies the signed bytes'));
  console.log(dim('  before anything else can happen.'));
  console.log('');

  // `next build` writes a production artifact, so do it first when asked for it.
  if (options.prod) {
    console.log(dim('  Building the production bundle…'));
    const buildStatus = await runNext(['build'], env);
    if (buildStatus !== 0) {
      console.error('');
      console.error('The production build failed. Nothing was started.');
      process.exit(buildStatus);
    }
  }

  const nextArgs = options.prod
    ? ['start', '-H', HOST, '-p', PORT]
    : ['dev', '-H', HOST, '-p', PORT];

  console.log(dim(`  Starting: next ${nextArgs.join(' ')}`));
  console.log('');
  const serverStatus = await runNext(nextArgs, env);

  if (serverStatus !== 0 && !stopSignal) {
    console.error('');
    console.error('The server exited with an error. Common causes:');
    console.error(`  - port ${PORT} is already in use: set a different one with PORT=3001 pnpm local`);
    console.error('  - dependencies are missing: run `pnpm install`');
    console.error('  - the toolchain is too old: run `pnpm local:check`');
  }
  process.exit(serverStatus);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
