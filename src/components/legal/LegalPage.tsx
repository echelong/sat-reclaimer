import Link from 'next/link';
import { Footer } from '@/src/components/landing/Footer';

export type LegalSection = {
  heading: string;
  body?: string[];
  /** Rendered as a definition-style list of short claim pairs. */
  facts?: { term: string; detail: string }[];
  list?: string[];
  note?: string;
};

/**
 * Shared shell for the policy, disclosure and information pages.
 *
 * Server components only: these pages are static text, they ship as HTML, and
 * nothing here imports from `src/lib`. The design system is the landing page's,
 * so the pages read as part of the same product rather than as an appendix.
 */
export function LegalPage({
  kicker,
  title,
  lede,
  updated,
  sections,
  children,
}: {
  kicker: string;
  title: string;
  lede: string;
  updated: string;
  sections: LegalSection[];
  children?: React.ReactNode;
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="legal-bar">
        <div className="wrap legal-bar-inner">
          <Link className="logo" href="/" aria-label="Sat Reclaimer home">
            <span className="logo-mark" aria-hidden="true">
              <span />
            </span>
            <span className="logo-word mono">
              SAT<span className="logo-slash">{'//'}</span>RECLAIMER
            </span>
          </Link>
          <nav className="legal-bar-nav mono" aria-label="Documents">
            <Link href="/open-source">Open source</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/risk">Risk</Link>
            <Link className="legal-bar-cta" href="/app">
              Launch app
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="section legal">
        <div className="wrap legal-wrap">
          <p className="kicker">{kicker}</p>
          <h1 className="legal-title display">{title}</h1>
          <p className="legal-lede">{lede}</p>
          <p className="legal-updated mono">Last updated {updated}</p>

          {children}

          <div className="legal-sections">
            {sections.map((section) => (
              <section className="legal-section card" key={section.heading}>
                <h2 className="legal-heading">{section.heading}</h2>
                {section.body?.map((paragraph) => (
                  <p className="legal-body" key={paragraph}>
                    {paragraph}
                  </p>
                ))}
                {section.facts && (
                  <dl className="legal-facts">
                    {section.facts.map((fact) => (
                      <div key={fact.term}>
                        <dt className="mono">{fact.term}</dt>
                        <dd>{fact.detail}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {section.list && (
                  <ul className="legal-list">
                    {section.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {section.note && <p className="legal-note mono">{section.note}</p>}
              </section>
            ))}
          </div>

          <p className="legal-foot mono">
            This page is part of the open-source project at{' '}
            <a className="trust-link" href="https://github.com/echelong/sat-reclaimer">
              github.com/echelong/sat-reclaimer
            </a>
            . If the code and this page ever disagree, the code is the behaviour you get and the
            disagreement is a bug worth reporting.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
