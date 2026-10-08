# Running SAT//RECLAIMER locally

There is no hosted version of this app and no account. You run it on your own
machine, your wallet signs, and the only thing that leaves your computer is the
requests described in [`/privacy`](../app/privacy/page.tsx).

Two ways to do this:

- **[Simple](#simple-installation)** — four commands, one of which is a launcher
  that asks what you want.
- **[Manual](#manual-installation)** — every step spelled out, for when you want
  to know exactly what is running, or when the simple path does not fit.

Neither path needs administrator rights, and neither will ever ask for a seed
phrase or private key. Nothing here downloads and executes a remote script: every
command below is a package manager you already have, or a script in this repository
that you can read first.

## Prerequisites

You need **Node.js 22 or newer** (an LTS release) and **pnpm 10**. Nothing else —
no database, no server, no Docker.

| Platform | Node.js | pnpm |
| --- | --- | --- |
| Fedora / RHEL | `sudo dnf install nodejs22` | `corepack enable` |
| Debian / Ubuntu | `sudo apt install nodejs npm` (check the version) | `corepack enable` |
| macOS | `brew install node@22` | `corepack enable` |
| Windows | `winget install OpenJS.NodeJS.LTS` | `corepack enable` |

`corepack` ships with Node and reads this repository's pinned
`packageManager: pnpm@10.17.1`, so doing it this way gets you the exact pnpm the
project was tested with rather than whatever is newest. If you prefer to install
pnpm yourself, `npm install -g pnpm@10` works too, or use
`npm install --global corepack`.

On Linux you can avoid a system-wide install entirely: download the Node tarball
from <https://nodejs.org/en/download>, unpack it in your home directory, and put
its `bin` on your `PATH`. That is often the right choice on a machine you do not
administer.

Check where you stand at any point:

```bash
node scripts/check-environment.mjs     # or: pnpm local:check
```

It only looks and reports — it installs nothing, downloads nothing, changes
nothing, and explains the fix for anything missing on your platform.

## Simple installation

```bash
git clone https://github.com/echelong/sat-reclaimer.git
cd sat-reclaimer
corepack enable          # one-time; makes pnpm available at the pinned version
pnpm install             # installs dependencies, nothing global
pnpm local               # asks which mode to run in, then starts
```

Then open <http://127.0.0.1:3000>, go to **/app**, and follow the console.

`pnpm local` is a launcher, not a magic script. It is
[`scripts/start-local.mjs`](../scripts/start-local.mjs), about 250 lines, and it
does three things: prints exactly which capabilities it is about to enable, sets
the three `NEXT_PUBLIC_*` flags accordingly, and runs the normal Next.js dev
server bound to `127.0.0.1`. Read it before you run it if you like — that is the
point of it being a file in the repository rather than a piped installer.

### Modes

| Choice | Mainnet | Testnet broadcast | Mainnet broadcast | What you can do |
| --- | --- | --- | --- | --- |
| **Look and plan only** (default) | off | off | off | Connect, scan, plan, review fees. Nothing can be sent. |
| **Signet / Testnet** | off | on | off | Everything, on a chain whose coins are worthless. |
| **Mainnet, no broadcast** | on | off | off | Real BTC: scan, plan, sign, verify. Cannot submit. |
| **Mainnet + broadcast** | on | off | on | Everything, including moving real bitcoin. |

The default when you press Enter is the one where nothing can be spent. Choosing
Mainnet broadcasting also requires typing `I UNDERSTAND REAL BITCOIN CAN MOVE`,
and in a non-interactive shell it additionally refuses to start unless you pass
`--confirm-real-btc`, so a copy-pasted command cannot turn it on by accident.

### Ports and exposure

The server binds to `127.0.0.1`, not `0.0.0.0`. It is not reachable from your
phone, your LAN or the internet while it runs, and there is no flag to change
that. Use `PORT=3001 pnpm local` if 3000 is taken.

## Manual installation

Everything `pnpm local` does, by hand.

```bash
git clone https://github.com/echelong/sat-reclaimer.git
cd sat-reclaimer
corepack enable
pnpm install --frozen-lockfile
pnpm dev                 # http://127.0.0.1:3000
```

`--frozen-lockfile` installs exactly the versions in `pnpm-lock.yaml` and fails
rather than silently resolving something else. That is what CI uses.

`pnpm dev` and `pnpm start` do the same thing as the launcher with every flag
off: safe mode. To change the mode yourself, set the environment variables the
launcher would have set:

```bash
# Signet/Testnet, broadcasting allowed
NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST=true pnpm dev

# Mainnet: build and sign, but no broadcast
NEXT_PUBLIC_ENABLE_MAINNET=true pnpm dev

# Mainnet with broadcasting. Both flags are required; one is not enough.
NEXT_PUBLIC_ENABLE_MAINNET=true NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST=true pnpm dev
```

Each flag is off unless it is exactly the string `true`. Anything else — unset,
`1`, `TRUE`, a typo — is off.

### A production build instead of the dev server

```bash
pnpm build
pnpm start               # serves the built app on 127.0.0.1:3000
```

Or in one step, which builds first and only starts if the build succeeded:

```bash
pnpm local --mode=plan --prod
```

### Why these are environment variables

They are `NEXT_PUBLIC_*` values, which means Next.js inlines them into the page at
build time. They are browser configuration, not secrets, and **not a security
boundary**: anyone can read them, and anyone can rebuild with different ones. What
actually protects your bitcoin is that your wallet approves one exact transaction,
and that this app decodes and verifies the signed bytes before anything else can
happen. See [`SECURITY.md`](../SECURITY.md).

If you are running this from an untrusted network or a shared machine, leave
broadcasting off. There is no reason to enable it until the moment you intend to
send.

## What to expect on first run

1. **Connect Xverse.** The console proves your Ordinals address is the BIP86
   output of the public key the wallet reports, or it stops. Only Xverse is
   supported today, through Sats Connect.
2. **Read the destructive notice and acknowledge it.** Spending an
   inscription-bearing output moves whatever it carries — the inscription, rare
   sat ranges, rune balances. The tool cannot detect most of that, so it will not
   tell you an output is safe.
3. **Scan all inscriptions.** Pages are fetched until the indexer's total is
   exhausted; an incomplete scan blocks the sweep.
4. **Review.** You are shown the input count, total input sats, the exact mining
   fee derived from the measured transaction, and the fee as a percentage of what
   you recover.
5. **Sign in Xverse.** The wallet is asked to sign one exact transaction with
   `broadcast: false`. It is never asked to broadcast.
6. **Verify.** The signed PSBT is decoded by code that shares no state with the
   builder, and every input's BIP341 sighash and Schnorr signature is re-checked.
7. **Broadcast**, if you enabled it, is a separate action for one exact `txid`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `pnpm: command not found` | Run `corepack enable`, or `npm install -g pnpm@10`. |
| `Unsupported engine` / Node too old | Install Node 22+ (see the table above), then re-run. |
| Port already in use | `PORT=3001 pnpm local`, and restart the server after changing modes. |
| Mainnet still shows `Mainnet (locked in code)` | The flags are baked in at build time. Stop the server and restart it in the mode you want; editing the page is not enough. |
| The wallet is not detected | Only the Xverse extension or Xverse's in-app browser is supported. The console reports `[WALLET_NOT_INSTALLED]` when it cannot see a provider. |
| Something failed mid-flow | The console prints a bracketed code such as `[SCAN_INCOMPLETE]`. Include it in any bug report. |

## Two limits worth knowing before you start

- **A refresh loses an unsigned transaction.** Signed bytes live in browser
  memory only and are never written to disk or sent anywhere. Use *Download
  verified .hex* before you refresh or close the tab; the *Recover a saved
  transaction* panel can bring that file back and submit it without signing
  again. It will still ask you to authorize that exact `txid`, and it will never
  broadcast on its own. See [`docs/PUBLIC_BETA.md`](PUBLIC_BETA.md).
- **This is an unaudited beta.** No independent security review has been
  performed. [`docs/RELEASE_GATES.md`](RELEASE_GATES.md) states exactly what is
  proven and what is not, rather than a summary that sounds reassuring.
