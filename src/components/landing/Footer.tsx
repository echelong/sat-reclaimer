import Link from 'next/link';

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <span className="logo-word mono">
              SAT<span className="logo-slash">{'//'}</span>RECLAIMER
            </span>
            <p className="footer-tag">
              Spend the bitcoin underneath unwanted inscriptions — without handing anyone your keys.
            </p>
          </div>

          <nav className="footer-nav" aria-label="Footer">
            <div>
              <h2 className="footer-head mono">Product</h2>
              <Link href="/app">Launch App</Link>
              <a href="#how-it-works">How It Works</a>
              <a href="#demo">Demo</a>
              <a href="#faq">FAQ</a>
            </div>
            <div>
              <h2 className="footer-head mono">Safety</h2>
              <a href="#security">Trust &amp; Security</a>
              <a href="#problem">Why this exists</a>
            </div>
          </nav>
        </div>

        <hr className="hairline" />

        <div className="footer-bottom">
          <p className="footer-fine mono">
            Non-custodial. No seed phrase. Not independently audited. Beta software — verify anything
            you are about to sign. Network fees are set by the Bitcoin network and are not paid to Sat
            Reclaimer.
          </p>
          <p className="footer-fine mono footer-fine-dim">
            An inscription-bearing UTXO is an ordinary Bitcoin UTXO. Spending one can move every asset
            it carries.
          </p>
        </div>
      </div>
    </footer>
  );
}
