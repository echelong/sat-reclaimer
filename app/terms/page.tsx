import type { Metadata } from 'next';
import { LegalPage } from '@/src/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of use | Sat Reclaimer',
  description:
    'Terms of use for Sat Reclaimer: free software, no custody, no warranty, no platform fees, and you are the only person who can authorize a transaction.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <LegalPage
      kicker="Terms of use"
      title="Free software, used at your own risk, with your own keys."
      lede="Sat Reclaimer is open-source software published under the MIT licence. It is not a service, it holds nothing, and it cannot act for you. These terms describe what you are agreeing to when you use it — and, more importantly, what the software can and cannot do on your behalf."
      updated="8 October 2026"
      sections={[
        {
          heading: 'The licence governs this software',
          body: [
            'The code is licensed under the MIT licence. That licence is the operative legal text, and it is included in the repository as LICENSE. It grants you broad rights to use, copy, modify and redistribute the software, and it disclaims all warranties.',
            'If anything on this page appears to conflict with the MIT licence, the MIT licence wins.',
          ],
        },
        {
          heading: 'No custody, and no ability to move your funds',
          body: [
            'Sat Reclaimer never holds, receives, controls or has access to your bitcoin or your keys. There is no deposit address, no account, and no server that holds funds. The application builds an unsigned transaction in your browser and asks your wallet to sign it; the wallet is the only party that can authorize anything.',
            'You are solely responsible for your own keys, your own wallet, your own destination address, and the transaction you approve. This includes the case where you paste a destination address that is wrong, or paste an address belonging to someone else.',
          ],
        },
        {
          heading: 'No platform fee',
          body: [
            'There is no fee, no percentage of recovered sats, no subscription and no paid tier. You pay the Bitcoin network fee, which is set by the network and the fee rate you choose, and which is paid to miners. This project receives none of it.',
            'There is nothing to refund because there is nothing we are paid.',
          ],
        },
        {
          heading: 'No warranty, and no guarantee of fitness',
          body: [
            'The software is provided "as is", without warranty of any kind. It has not been independently security-audited. It is an early public beta, and it may contain defects that could cause you to build, sign or broadcast something different from what you intended.',
            'To the maximum extent permitted by law, the authors and copyright holders are not liable for any claim, damages or other liability arising from the software or its use, including lost bitcoin, lost inscriptions, lost assets, or network fees.',
            'Nothing is guaranteed: not that every asset is detected, not that every wallet works, not that a transaction will be relayed or confirmed, and not that the software is free of defects.',
          ],
        },
        {
          heading: 'Spending an inscription output is destructive and irreversible',
          body: [
            'The purpose of this tool is to deliberately spend inscription-bearing outputs as ordinary bitcoin. That can move or permanently affect inscriptions, rare sats, runes, BRC-20 state and anything else the output carries. Bitcoin transactions cannot be reversed once confirmed.',
            'Read the full disclosure at /risk before using this on Mainnet. Acknowledging the in-app warning is a real acceptance of that risk, not a formality.',
          ],
        },
        {
          heading: 'Acceptable use and your responsibilities',
          list: [
            'You will not use this tool to spend outputs you do not control, or in any way that violates applicable law in your jurisdiction.',
            'You will comply with any tax obligations that arise from moving or disposing of bitcoin or of the assets an output carries.',
            'You accept that the software has no way to know whether an inscription matters to anyone, and that it will not stop you spending a valuable one: it only warns you, in advance, that this can happen.',
            'You will not describe this project as audited, certified or risk-free when discussing it with others, because it has not been audited.',
          ],
        },
        {
          heading: 'Third parties',
          body: [
            'The software relies on your wallet and on public Bitcoin APIs. Those are independent third parties with their own terms and their own availability. This project does not control them, does not warrant them, and is not responsible for their behaviour — including a decision to refuse a transaction or to be temporarily unavailable.',
          ],
        },
        {
          heading: 'Changes',
          body: [
            'These terms describe the software in this repository at this commit. Any material change to them will appear in the repository history alongside the change in behaviour that prompted it. Continuing to use a later version means accepting the terms published with it.',
          ],
        },
      ]}
    />
  );
}
