import type { Metadata } from 'next';
import { LegalPage } from '@/src/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Risk disclosure | Sat Reclaimer',
  description:
    'Spending an inscription output is destructive and irreversible, asset detection is incomplete, and this software has not been audited. Read this before using it on Mainnet.',
  alternates: { canonical: '/risk' },
};

export default function RiskPage() {
  return (
    <LegalPage
      kicker="Risk disclosure"
      title="This software moves real bitcoin. Read this first."
      lede="Sat Reclaimer deliberately spends inscription-bearing outputs as ordinary bitcoin. That is the entire point of it, and it means every action here is destructive and irreversible by design. This page is the full list of what you are accepting — it is the same text that lives in the repository as docs/RISK.md."
      updated="8 October 2026"
      sections={[
        {
          heading: 'Spending an inscription output is destructive and irreversible',
          body: [
            'Bitcoin transactions cannot be reversed. Once a transaction is confirmed, the inputs are spent and the sats have moved. There is no support process, no refund and no recovery path. If you sweep to the wrong address, the sats are gone.',
          ],
        },
        {
          heading: 'Inscriptions and other assets travel with the sats',
          body: [
            'An inscription is data carried in an output, not a separate balance. When you spend that output, whatever it carries goes with it — including rare sat ranges, rune balances, BRC-20 state and other protocol data.',
            'The inscription is not erased. Its contents stay on chain at their genesis location forever. What changes is which output carries it and who controls that output.',
            'You are spending collectible value at postage value. Most inscription outputs hold a few hundred to a few thousand sats. If an inscription actually matters to someone, spending it destroys that market position permanently, and the mining fee may be a large share of what you recover.',
          ],
        },
        {
          heading: 'Asset detection is structurally incomplete',
          body: [
            'The interface this application can read does not report runes, BRC-20 balances or rare sats at all. It therefore cannot tell you whether an output is "safe", and it never infers safety from an inscription count. A UTXO with one inscription and a UTXO with fifty are equally opaque to it.',
            'The in-app acknowledgement is a real acceptance of that uncertainty, not a formality. The app will not present an output as safe, and neither should you read a low inscription count as one.',
          ],
        },
        {
          heading: 'Fees are real money, and small wallets may not be worth sweeping',
          body: [
            'Fees scale with transaction size, and each Taproot input costs about 230 weight units (roughly 57–58 vB) to spend. If each output holds only a few hundred sats, a high fee rate can consume most or all of the value.',
            'The application evaluates the whole selected set together and refuses a sweep whose remainder would be below the relay threshold, but "economically possible" is not the same as "worth doing". The fee, the resulting output and the fee as a percentage of recovered value are all shown before you sign, and a warning appears above 25%.',
          ],
        },
        {
          heading: 'This software has not been audited',
          body: [
            'It is an early public beta. It has not been independently security-audited, and an internal review is not an external one. A confirmed 1,079-input Mainnet sweep is evidence that this shape of transaction works and that the sizing model matches reality — it is not a guarantee, and it is not an audit.',
            'Use it first on a chain that does not hold real value if you can, and never sign anything you have not read.',
          ],
        },
        {
          heading: 'Your transaction may be rejected, and nothing retries for you',
          body: [
            'A node can refuse a transaction for its fee rate, for conflicting or already-spent inputs, or by policy. The application reports the node’s answer verbatim and never retries automatically. It is not a wallet, it does not control your keys, and it cannot unstick a transaction for you.',
            'An ambiguous or timed-out submission is resolved by looking the txid up on independent nodes. Nothing is ever resubmitted, and the app never signs a replacement transaction on its own.',
          ],
        },
        {
          heading: 'Third parties see your addresses and your transactions',
          body: [
            'Your wallet sees the signing request. The public broadcast nodes see the transaction, which is public chain data the moment it is relayed. Your wallet’s indexer sees your address when the wallet enumerates inscriptions.',
            'There is no analytics, no tracker, no account, and nothing about your wallet is stored on a server by this project. See /privacy for the specifics.',
          ],
        },
        {
          heading: 'What this project claims, and what it does not',
          facts: [
            { term: 'Free, no platform fee', detail: 'True. No percentage of recovered sats, no subscription, no paid tier.' },
            {
              term: 'Non-custodial',
              detail: 'True. No keys, no accounts, no deposit address, no server holding funds.',
            },
            {
              term: 'Every signed transaction independently verified before broadcast',
              detail:
                'True. Inputs, prevout values, scripts, destination, amount, fee, conservation, txid stability and every Schnorr signature are re-derived from the signed PSBT.',
            },
            {
              term: 'A real 1,079-input Mainnet sweep is confirmed on chain',
              detail:
                'True, with the transaction, block height and arithmetic in docs/MAINNET_ACCEPTANCE.md — and one confirmed sweep is evidence, not a guarantee.',
            },
            { term: 'Independently security-audited', detail: 'False. It has not been.' },
            {
              term: 'Guaranteed safe, or every asset detected',
              detail: 'False. Nothing is guaranteed, and runes, BRC-20 and rare sats are undetectable here.',
            },
            {
              term: 'Every wallet supported',
              detail: 'False. Xverse through Sats Connect, and only Xverse, is supported today.',
            },
            { term: 'Bitcoin transfers are reversible', detail: 'False.' },
          ],
        },
        {
          heading: 'Not financial, legal or tax advice',
          body: [
            'Nothing here is advice of any kind. You are responsible for your own keys, your own decisions, and any tax consequences of moving bitcoin or disposing of the assets an output carries.',
          ],
        },
      ]}
    />
  );
}
