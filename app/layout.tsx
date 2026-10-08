import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';
import './landing.css';
import './console.css';

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

/**
 * The canonical public origin. It is intentionally not guessed: Open Graph and
 * sitemap URLs must be absolute and correct before the product is announced, so
 * the deployment sets `NEXT_PUBLIC_SITE_URL`. Until then the metadata is valid
 * but points at localhost, which is a pre-launch blocker (see docs/PUBLIC_BETA.md).
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const title = 'Sat Reclaimer | Recover BTC from Ordinals Inscriptions';
const description =
  'Recover Bitcoin from unwanted Ordinals inscriptions. Connect your wallet, scan inscription UTXOs, and sweep sats as BTC. Non-custodial and free.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: '%s | Sat Reclaimer',
  },
  description,
  applicationName: 'Sat Reclaimer',
  keywords: [
    'Bitcoin',
    'Ordinals',
    'inscriptions',
    'Taproot',
    'P2TR',
    'UTXO',
    'sats',
    'reclaim',
    'sweep',
    'non-custodial',
    'Xverse',
    'BRC-20',
    'Runes',
  ],
  authors: [{ name: 'Sat Reclaimer' }],
  creator: 'Sat Reclaimer',
  category: 'technology',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Sat Reclaimer',
    title,
    description,
    url: '/',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Sat Reclaimer — your inscriptions are worthless, your sats aren’t.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: '#080B12',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
