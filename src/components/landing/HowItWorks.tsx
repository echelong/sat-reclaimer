import { Reveal } from '@/src/components/ui/Reveal';

const STEPS = [
  {
    id: '01',
    title: 'Connect',
    body: 'Connect a supported Bitcoin wallet. Your keys remain inside your wallet.',
    detail: 'wallet_connect → BIP86 proof',
    art: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="4" y="14" width="16" height="20" rx="3" />
        <path d="M8 20h8M8 25h5" strokeLinecap="round" />
        <circle cx="35" cy="16" r="5" />
        <path d="M35 21v11a4 4 0 0 0 4 4h5" strokeLinecap="round" />
        <path d="M20 24h10" strokeLinecap="round" strokeDasharray="2 3" />
      </svg>
    ),
  },
  {
    id: '02',
    title: 'Scan',
    body: 'Discover inscription-bearing Taproot UTXOs and calculate their Bitcoin value.',
    detail: 'ord_getInscriptions → full pagination',
    art: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M6 30a18 18 0 0 1 36 0" strokeLinecap="round" />
        <path d="M13 30a11 11 0 0 1 22 0" strokeLinecap="round" opacity="0.7" />
        <path d="M20 30a4 4 0 0 1 8 0" strokeLinecap="round" opacity="0.45" />
        <path d="M24 30v12" strokeLinecap="round" strokeDasharray="2 3" />
        <circle cx="24" cy="42" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: '03',
    title: 'Review',
    body: 'Select the UTXOs you want to spend. Inspect destination, fees, expected BTC output, and affected assets.',
    detail: 'exact fee · exact output · exact vsize',
    art: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="6" y="8" width="30" height="32" rx="3" />
        <path d="M11 17h20M11 24h20M11 31h11" strokeLinecap="round" opacity="0.6" />
        <path d="M31 30l5 5 8-9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: '04',
    title: 'Reclaim',
    body: 'Sign with your wallet. Independently verify the Bitcoin transaction. Broadcast only after your explicit approval.',
    detail: 'sign → verify → authorize → broadcast',
    art: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M6 12h18l10 12-10 12H6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="38" cy="24" r="4.5" />
        <path d="M10 24h12" strokeLinecap="round" strokeDasharray="2 3" />
      </svg>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="section hiw" id="how-it-works">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">How it works</span>
          <h2 className="section-title">
            Four steps, and the wallet is never <span className="hl">out of your hands</span>.
          </h2>
          <p className="section-lede">
            Building, signing, verifying and broadcasting are four separate operations. Nothing is
            fused into one opaque button, and signing never broadcasts.
          </p>
        </div>

        <ol className="hiw-grid">
          {STEPS.map((step, index) => (
            <li key={step.id}>
              <Reveal delay={index * 90} className="hiw-cell">
                <article className="hiw-card card bracket">
                  <span className="hiw-index mono">{step.id}</span>
                  <span className="hiw-art">{step.art}</span>
                  <h3 className="hiw-title display">{step.title}</h3>
                  <p className="hiw-body">{step.body}</p>
                  <span className="hiw-detail mono">{step.detail}</span>
                </article>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
