import { Reveal } from '@/src/components/ui/Reveal';

const BLOCKS = [
  {
    title: 'Non-custodial',
    body: 'We never take possession of your Bitcoin. There is no deposit address, no account, and no server that holds funds.',
    glyph: '◎',
  },
  {
    title: 'No seed phrase',
    body: 'The application never asks for wallet recovery words — not on any screen, ever. It has no field to type one into.',
    glyph: '⌀',
  },
  {
    title: 'Wallet signing',
    body: 'Transaction approval happens through your supported wallet. The app asks your wallet to sign specific inputs and nothing else.',
    glyph: '✎',
  },
  {
    title: 'Verify before broadcast',
    body: 'Every signed transaction is decoded and checked independently of the code that built it: inputs, scripts, values, fee, and one Schnorr signature verification per input.',
    glyph: '✔',
  },
  {
    title: 'Transparent fees',
    body: 'You see the Bitcoin network fee and the exact resulting output before you sign. There is no application fee and nothing is deducted by us.',
    glyph: '≡',
  },
  {
    title: 'You control the destination',
    body: 'You enter and confirm the receiving address. Broadcasting is a separate action that needs your explicit authorization for that exact transaction.',
    glyph: '→',
  },
];

/**
 * SECTION — TRUST & SECURITY
 *
 * Deliberately claim-light. No badge, no "audited", no "bank-grade": the only
 * statements here are ones the code actually enforces. The audit line is an
 * admission, not a marketing line, and it stays until a real audit exists.
 */
export function Trust() {
  return (
    <section className="section trust" id="security">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">Trust &amp; security</span>
          <h2 className="section-title">
            Your keys. Your Bitcoin. <span className="hl">Your decision.</span>
          </h2>
          <p className="section-lede">
            Everything below is enforced in code, not in copy. Where the software cannot prove
            something, it says so instead of guessing.
          </p>
        </div>

        <ul className="trust-grid">
          {BLOCKS.map((block, index) => (
            <li key={block.title}>
              <Reveal delay={index * 70}>
                <article className="trust-card card bracket">
                  <span className="trust-glyph mono" aria-hidden="true">
                    {block.glyph}
                  </span>
                  <h3 className="trust-title">{block.title}</h3>
                  <p className="trust-body">{block.body}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>

        <div className="trust-warning" role="note">
          <span className="trust-warning-icon" aria-hidden="true">
            ⚠
          </span>
          <div>
            <h3>Spending an inscription output is destructive</h3>
            <p>
              Spending inscription-bearing UTXOs can transfer inscriptions, rare sats, Runes, and
              other assets. This tool does not erase those assets or preserve their collectible
              value.
            </p>
            <p className="trust-warning-sub">
              Asset detection is also incomplete. The data source this app can read does not report
              Runes, BRC-20 balances, or rare sats, so the app never claims an output is safe and
              never infers safety from an inscription count. You acknowledge this explicitly before
              any output becomes selectable.
            </p>
          </div>
        </div>

        <div className="trust-honest">
          <Reveal>
            {/* Wrapped in one span on purpose: `.trust-honest-line` is a grid
             * container, so bare inline children would each become their own
             * grid row instead of flowing as one paragraph. */}
            <p className="trust-honest-line mono">
              <span className="tag tag-ok">Verified sweep</span>
              <span>
                This tool&apos;s weight model and a real Mainnet sweep agree to the weight unit. A
                confirmed transaction spent 1,079 inscription-bearing Taproot outputs in{' '}
                <strong>one</strong> 248,348 WU transaction, paying 62,087 sats to move 601,214 sats
                — exactly <code>vsize × 1 sat/vB</code>, with no platform fee of any kind. TXID{' '}
                <a
                  className="trust-link"
                  href="https://mempool.space/tx/0a7d30ca8f940b137c96c65bb32ffec34f53a8a128cadf154f8df83055257e1a"
                  target="_blank"
                  rel="noreferrer"
                >
                  0a7d30ca…55257e1a ↗
                </a>{' '}
                in block 970454. Verify it yourself — the arithmetic is in{' '}
                <code>docs/MAINNET_ACCEPTANCE.md</code>. One confirmed sweep is evidence, not a
                guarantee, and it is not an audit.
              </span>
            </p>
          </Reveal>
          <Reveal delay={90}>
            <p className="trust-honest-line mono">
              <span className="tag tag-warn">Not audited</span>
              Sat Reclaimer has not been independently security-audited. It is an early public beta
              built on a small, readable Bitcoin transaction core, and the code that builds, verifies
              and broadcasts transactions is open to review — but &ldquo;open to review&rdquo; is not
              &ldquo;audited&rdquo;, and we will not pretend otherwise.
            </p>
          </Reveal>
          <Reveal delay={180}>
            <p className="trust-honest-line mono">
              <span className="tag">Mainnet opt-in</span>
              Real-value Mainnet use is never a default. It is a deliberate, separate switch, and
              broadcasting real BTC requires a second, independent authorization on top of it.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
