import type { Metadata } from 'next';
import { AppBar } from '@/src/components/console/AppBar';
import { Reclaimer } from '@/src/components/Reclaimer';

export const metadata: Metadata = {
  title: 'Reclaim Console',
  description:
    'Connect a supported Bitcoin wallet, scan inscription-bearing Taproot UTXOs, and sweep their sats as BTC. Build, sign, verify and broadcast are four separate steps.',
  alternates: { canonical: '/app' },
};

/**
 * The working application. It moved from `/` to `/app` so the public landing page
 * can live at the product root; no wallet, PSBT, signing, verification or
 * broadcast code changed in the move.
 */
export default function AppPage() {
  return (
    <>
      <a className="skip-link" href="#console">
        Skip to console
      </a>
      <AppBar />
      <Reclaimer />
    </>
  );
}
