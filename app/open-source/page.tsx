import type { Metadata } from 'next';
import { LegalPage } from '@/src/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Open source | Sat Reclaimer',
  description:
    'Read the code, build it locally, check the licence. MIT licensed, no telemetry, no build step that hides anything. Includes security reporting and wallet compatibility.',
  alternates: { canonical: '/open-source' },
};

export default function OpenSourcePage() {
  return (
    <LegalPage
      kicker="Open source"
      title="Read it, build it, or run it yourself."
      lede="The whole product is in one repository under the MIT licence: the landing page, the console, and the Bitcoin transaction core. Nothing is minified away that you cannot rebuild from source, and there is no server component to trust."
      updated="8 October 2026"
      sections={[
        {
          heading: 'Where the code is',
          facts: [
            {
              term: 'Repository',
              detail: 'github.com/echelong/sat-reclaimer — public, MIT licensed.',
            },
            {
              term: 'Licence',
              detail:
                'MIT, with the third-party licence list in LICENSE. Dependencies are permissive (MIT and Apache-2.0) and the fonts are under the SIL Open Font License.',
            },
            {
              term: 'Run it locally',
              detail:
                'pnpm install && pnpm dev, then open http://localhost:3000. Every feature flag defaults to off; see the README for the environment variables.',
            },
            {
              term: 'Verify the Bitcoin core',
              detail:
                'pnpm test runs the whole offline suite with no network access: transaction construction, an independent BIP341 sighash implementation checked against the library, per-input Schnorr verification, broadcast rejection handling, and wallets from 1 to 5,000 UTXOs. pnpm test:max adds the 10,000-UTXO plan.',
            },
            {
              term: 'Audit the claims',
              detail:
                'docs/MAINNET_ACCEPTANCE.md contains the raw endpoint evidence, the locally re-derived txid, the weight arithmetic and the endpoint request log for the confirmed Mainnet sweep. docs/SECURITY_REVIEW.md documents the review findings and fixes.',
            },
          ],
        },
        {
          heading: 'What open source does and does not give you',
          body: [
            'It gives you the ability to check every claim on this website against code you can read and run. That is the only reason this project can honestly say "no platform fee" and "no seed phrase" without asking you to trust a promise.',
            'It does not give you a guarantee that the code is correct. This software has not been independently security-audited. Reading the source is a real form of verification; it is not a substitute for an audit, and it will not be described as one.',
          ],
        },
        {
          heading: 'Security reporting',
          body: [
            'Anything exploitable — a way to make someone sign or broadcast something other than what they reviewed, a bypass of a verification or authorization gate, or any exposure of key material — must not be reported in a public issue.',
          ],
          list: [
            'Use GitHub’s private reporting: open the repository’s Security tab and choose "Report a vulnerability". It is private and it notifies the maintainer directly.',
            'Include what the flaw is, what an attacker gains, and whether it can affect a Mainnet transaction.',
            'Never include a seed phrase, private key or wallet file, even if you believe it is already compromised.',
            'No security email address, PGP key or bug bounty exists yet. That is recorded as an open item rather than papered over with an invented address.',
          ],
          note: 'The full policy, including what is in scope, is in SECURITY.md in the repository.',
        },
        {
          heading: 'Supported wallets',
          facts: [
            { term: 'Supported today', detail: 'Xverse, through the Sats Connect interface, in a desktop browser extension or the Xverse in-app browser.' },
            {
              term: 'Hard requirements',
              detail:
                'The wallet must expose a Taproot (P2TR) Ordinals address, report a public key that this app can verify is that address’s BIP86 output, and expose a signing interface through Sats Connect. A wallet that fails the address-and-key proof is refused before anything is built.',
            },
            {
              term: 'Not tested',
              detail:
                'Any other Sats Connect wallet. If one connects, that is not the same as "it signs and the result verifies". Wallet compatibility reports are welcome and there is a template for them.',
            },
            {
              term: 'Not supported',
              detail:
                'Hardware wallets on their own, seed-phrase import, watch-only mode, and any wallet that cannot sign Taproot key-path inputs.',
            },
          ],
        },
        {
          heading: 'Supported networks',
          facts: [
            { term: 'Mainnet', detail: 'Supported, and never a default. Both an operator flag and a per-transaction authorization are required before anything is broadcast; the second one is yours.' },
            { term: 'Testnet and Signet', detail: 'Supported. Broadcasting needs its own separate operator flag.' },
            {
              term: 'Honest limitation',
              detail:
                'The Signet/Testnet path has never been exercised end to end, because no inscription-bearing Signet UTXO exists to sweep. The Mainnet sweep is the verified one, and the code path is the same.',
            },
          ],
        },
        {
          heading: 'What you have to trust, even with the source',
          list: [
            'Your wallet’s implementation, and its return values. This app validates them, but it does not audit the wallet.',
            'The ordinals data source behind your wallet’s inscription API. Every row it returns is treated as untrusted input and validated, but the app cannot prove the list is complete beyond what the API reports.',
            'The public Bitcoin nodes used for broadcasting and status. Two independent operators are used, and either can refuse to relay. A transaction is public chain data the moment it is submitted to any of them.',
            'Your own review of the destination address. The app validates the address encoding and re-checks the destination script after signing, but it cannot know whether the address is the one you meant to pay.',
          ],
        },
      ]}
    />
  );
}
