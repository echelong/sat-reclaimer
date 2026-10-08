'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const LINKS = [
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#problem', label: 'Problem' },
  { href: '#security', label: 'Security' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * Sticky product navigation.
 *
 * Compact, semi-transparent and blurred, with a hairline that only appears once
 * the page has scrolled so the hero stays edge-to-edge. The mobile panel is a
 * plain conditional render with Escape handling and correct `aria-expanded`.
 *
 * The scroll listener is passive, coalesced into a single rAF, and only ever
 * writes two state booleans, so it cannot cause layout thrash. There is no
 * public repository yet, so no GitHub link is shown — a dead link would be worse
 * than no link.
 */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const y = window.scrollY;
        setScrolled(y > 12);
        const span = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(span > 0 ? Math.min(1, Math.max(0, y / span)) : 0);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="nav" data-scrolled={scrolled ? 'true' : 'false'}>
      <div className="nav-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="wrap nav-inner">
        <Link className="logo" href="/" aria-label="Sat Reclaimer home">
          <span className="logo-mark" aria-hidden="true">
            <span />
          </span>
          <span className="logo-word mono">
            SAT<span className="logo-slash">{'//'}</span>RECLAIMER
          </span>
        </Link>

        <nav className="nav-links" aria-label="Sections">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="nav-link mono">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <Link className="btn btn-primary btn-sm nav-cta" href="/app">
            Launch App
          </Link>
          <button
            type="button"
            className="nav-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            <span data-open={open ? 'true' : 'false'} />
            <span data-open={open ? 'true' : 'false'} />
          </button>
        </div>
      </div>

      {open && (
        <div className="nav-panel" id="mobile-menu">
          <div className="wrap">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="nav-panel-link display"
                onClick={() => setOpen(false)}
              >
                {link.label}
                <span aria-hidden="true">↗</span>
              </a>
            ))}
            <Link className="btn btn-primary btn-block" href="/app" onClick={() => setOpen(false)}>
              Launch App
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
