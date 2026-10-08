import type { Metadata } from 'next';
import { LegalPage } from '@/src/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy | Sat Reclaimer',
  description:
    'What Sat Reclaimer sends, to whom, and what it never collects. No accounts, no analytics, no trackers, no server-side storage of wallet data.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      kicker="Privacy"
      title="What leaves your browser, and where it goes."
      lede="Sat Reclaimer is a static application. There is no account, no session, no analytics, no tracker and no server that stores anything about your wallet. Everything it sends is either to your own wallet or to a public Bitcoin node, and this page names every one of them."
      updated="8 October 2026"
      sections={[
        {
          heading: 'What this application stores',
          body: [
            'Nothing about your wallet is stored. A signed transaction lives in browser memory only, and refreshing or closing the tab discards it. When you click "Download verified .hex", the file is written by your browser to your own machine; nothing is uploaded.',
            'There is no database, no account, no cookie used for identification, and no server-side log of your addresses. The application is served as static files and has no server routes at all.',
          ],
          facts: [
            { term: 'Cookies', detail: 'None. Not for analytics, not for preferences, not for anything.' },
            {
              term: 'Analytics and trackers',
              detail: 'None. No third-party script is loaded, and the Content Security Policy blocks loading one.',
            },
            {
              term: 'localStorage / IndexedDB / sessionStorage',
              detail:
                'Not used to store wallet data. If a future version adds encrypted on-device recovery, this page will say so explicitly before that ships.',
            },
            {
              term: 'Server-side storage of wallet data',
              detail: 'None. There is no server side.',
            },
          ],
        },
        {
          heading: 'What is sent, and to whom',
          body: [
            'Every network request is either a wallet call through Sats Connect or a read-only or submission request to a public Bitcoin API. Nothing else is contacted.',
          ],
          list: [
            'Your wallet (Xverse, through Sats Connect): connect, enumerate inscriptions, and sign. The wallet is asked to sign specific input indexes with broadcast disabled, and it is never asked to broadcast.',
            'Your wallet’s own inscription data source: when the wallet enumerates your inscriptions, your Ordinals address is queried by the wallet, not by this application. How that provider treats the request is governed by the wallet, not by this page.',
            'mempool.space and blockstream.info: the raw transaction is POSTed here when — and only when — you explicitly authorize broadcasting that exact transaction. A txid lookup for confirmation status also goes to these hosts.',
            'mempool.emzy.de: an additional independent mempool.space instance that may be used as a fallback broadcast or status endpoint.',
            'No host receives your address or your transaction unless you scan or broadcast. Loading the page contacts nothing.',
          ],
          note: 'A broadcast transaction is public chain data the moment it is submitted: every node that relays it can see it, and so can anyone reading the chain. Addresses queried through the wallet are visible to the wallet’s provider. That is inherent to how Bitcoin and inscription indexing work, not something this application can hide.',
        },
        {
          heading: 'What is never collected',
          list: [
            'Seed phrases, recovery words, private keys or wallet files. There is no field for one, no code path that reads one, and no place to put one.',
            'Your IP address. This application has no server to record it. Note that the public Bitcoin APIs above will see the IP address that submits a broadcast, as any node would.',
            'Any identifier that persists across visits. There is nothing to persist and nowhere to put it.',
            'Wallet balances, history or analytics, beyond the inscription UTXOs needed to build the transaction you asked for.',
          ],
        },
        {
          heading: 'Legal basis and your choices',
          body: [
            'If you are in a jurisdiction with data protection law: the only personal data involved is your Bitcoin address and the transaction you choose to build, and it is processed solely to perform the action you requested. Because nothing is stored by this application, there is nothing to request, export or delete from it.',
            'The Bitcoin network is public and permanent. If you have broadcast a transaction, no one — including this project — can remove it from the chain. That is true of every Bitcoin transaction and is not a property of this application.',
          ],
        },
        {
          heading: 'If this changes',
          body: [
            'Any future feature that would collect, transmit or store something new — encrypted device-local recovery, for example — must be described here before it ships, and the change will be visible in this repository’s history. This page describes the behaviour of the code in the same repository; if they ever disagree, the disagreement is a bug.',
          ],
        },
      ]}
    />
  );
}
