# Risk disclosure

**This software moves real bitcoin. Read this before you use it on Mainnet.**

The same text is published at `/risk` on the website. This copy exists so the
disclosure is readable from the repository itself.

## What this tool does

Sat Reclaimer deliberately spends inscription-bearing Taproot UTXOs as ordinary
Bitcoin inputs and sweeps their monetary value to one destination address you
choose. It does not delete inscriptions, it does not convert Ordinals into
Bitcoin, and it does not take custody of anything.

## The risks you are accepting

### Spending an inscription output is destructive and irreversible

Bitcoin transactions cannot be reversed. Once a transaction is confirmed, the
inputs are spent and the sats have moved. There is no support process, no refund
and no recovery path.

### Inscriptions and other assets travel with the sats

An inscription is data carried in an output, not a separate balance. When you spend
that output, whatever it carries goes with it. That can include rare sat ranges,
rune balances, BRC-20 state and other protocol data. **The inscription is not
erased** — its contents stay on chain at their genesis location forever, but which
output carries it, and who controls that output, changes.

### Asset detection is structurally incomplete

The interface this application can read does not report runes, BRC-20 balances or
rare sats at all. It therefore **cannot** tell you whether an output is "safe", and
it never infers safety from an inscription count. A UTXO with one inscription and a
UTXO with fifty are equally opaque to it. You acknowledge this explicitly before
any output becomes selectable, and that acknowledgement is a real acceptance of
risk, not a formality.

### You are spending collectible value at postage value

Most inscription outputs hold a few hundred sats. If an inscription actually
matters to someone, spending it destroys that market position permanently, and the
Bitcoin network fee may be a large share of what you recover. The console shows
the exact fee, the exact destination output and the fee as a percentage of the
recovered value before you sign, and it warns prominently above 25%.

### Network fees are real money and are not paid to this project

There is no platform fee, no percentage, and no paid tier. You pay the Bitcoin
network fee and nothing else. Fees are set by the Bitcoin network and by the fee
rate you choose; this project receives none of it and cannot reduce it.

### A small wallet may not be worth sweeping

Fees scale with transaction size, and each Taproot input costs about 230 weight
units (~57–58 vB) to spend. If each output holds only a few hundred sats, a high
fee rate can consume most or all of the value. The application evaluates the whole
selected set together and refuses a sweep whose remainder would be unspendable, but
"economically possible" is not the same as "worth doing".

### Your transaction may be rejected by the network

A node can refuse a transaction for its fee rate, for conflicting or already-spent
inputs, or by policy. This application reports the node's answer verbatim and never
retries automatically. Note also that this software is not a wallet, does not
control your keys, and cannot unstick a transaction for you.

### Software can have bugs, and this software has not been audited

This is an early public beta. It has **not** been independently security-audited.
That is stated on the website and it is not a formality: an internal review is not
an external one, and no amount of testing is a guarantee. Use it first on a chain
that does not hold real value if you can, and never sign anything you have not
read.

### Third parties see your addresses and your transactions

The wallet you connect sees the request. The public broadcast nodes this
application submits to see the transaction — which is public chain data the moment
it is broadcast anyway. Your ordinal indexer sees your address when the wallet
queries it. See `/privacy` for the specifics. There is no analytics, no tracker and
no account, and nothing about your wallet is stored on a server by this project.

### Nothing here is financial, legal or tax advice

You are responsible for your own keys, your own decisions, and any tax consequences
of moving bitcoin.

## What this project claims and does not claim

| Claim | Status |
| --- | --- |
| Free, no platform fee, no subscription | true |
| Non-custodial: no keys, no accounts, no deposit address | true |
| Every signed transaction is independently decoded and verified before broadcast | true |
| Broadcasting is a separate, explicitly authorized action, never automatic | true |
| Mainnet is opt-in and off by default | true |
| A real 1,079-input Mainnet sweep is confirmed on chain | true, with evidence in `docs/MAINNET_ACCEPTANCE.md` |
| Independently security-audited | **false — it has not been** |
| Guaranteed safe, or all assets detected | **false — nothing is guaranteed and detection is incomplete** |
| Every wallet supported | **false — Xverse via Sats Connect, and only Xverse, is supported today** |
| Bitcoin transfers reversible | **false** |
