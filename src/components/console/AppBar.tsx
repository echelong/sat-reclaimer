import Link from 'next/link';

/**
 * Console app bar. Deliberately server-rendered: the console itself owns all
 * wallet and transaction state, so this is a static strip that only links back
 * to the public product. It stays sticky so "back to safety information" is
 * always one click away while reviewing a transaction.
 */
export function AppBar() {
  return (
    <header className="appbar">
      <div className="console-wrap appbar-inner">
        <Link className="logo" href="/" aria-label="Sat Reclaimer home">
          <span className="logo-mark" aria-hidden="true">
            <span />
          </span>
          <span className="logo-word mono">
            SAT<span className="logo-slash">{'//'}</span>RECLAIMER
          </span>
        </Link>
        <span className="appbar-tag mono">Reclaim Console</span>
        <nav className="appbar-links" aria-label="Product">
          <Link className="mono" href="/#how-it-works">
            How it works
          </Link>
          <Link className="mono" href="/#security">
            Security
          </Link>
          <Link className="mono" href="/#faq">
            FAQ
          </Link>
        </nav>
      </div>
    </header>
  );
}
