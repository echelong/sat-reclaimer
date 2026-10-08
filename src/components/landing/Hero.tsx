import Link from 'next/link';
import { HeroVisualization } from './HeroVisualization';

/**
 * SECTION A — HERO
 *
 * Layers, back to front: ambient page grid → canvas consolidation story → scrim
 * → copy. The copy is plain server-rendered HTML, so the headline, the lede and
 * both calls to action are in the first paint and in the accessibility tree
 * regardless of whether the canvas ever runs.
 */
export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-stage" aria-hidden="true">
        <HeroVisualization />
      </div>
      <div className="hero-scrim" aria-hidden="true" />

      <div className="wrap hero-inner">
        <div className="hero-copy">
          <p className="hero-beta">
            <span className="tag tag-cyan">
              <span className="pulse-dot" />
              Public Beta
            </span>
            <span className="hero-beta-note mono">non-custodial · no seed phrase · Mainnet is opt-in</span>
          </p>

          <h1 className="hero-title display">
            <span className="hero-dead">
              Your inscriptions are worthless.
              <span className="hero-strike" aria-hidden="true" />
            </span>
            <span className="hero-live">
              Your sats aren&apos;t.
              <span className="hero-live-underline" aria-hidden="true" />
            </span>
          </h1>

          <p className="hero-lede">
            Reclaim the Bitcoin locked inside unwanted Ordinals. Connect your wallet, scan your
            inscriptions, and sweep their sats as BTC.
          </p>

          <p className="hero-trust mono">
            <span className="hero-lock" aria-hidden="true">
              ▮
            </span>
            Non-custodial. No seed phrase. Your keys never leave your wallet.
          </p>

          <div className="hero-cta">
            <Link className="btn btn-primary hero-cta-main" href="/app">
              [ RECLAIM MY SATS → ]
            </Link>
            <a className="btn btn-ghost" href="#how-it-works">
              [ HOW IT WORKS ]
            </a>
          </div>
        </div>

        <figure className="hero-legend">
          <span className="hero-legend-node" aria-hidden="true" />
          <span className="mono">Scattered UTXOs</span>
          <span className="hero-legend-arrow" aria-hidden="true">
            <span />
          </span>
          <span className="hero-legend-node hero-legend-node-out" aria-hidden="true" />
          <span className="mono hero-legend-live">Consolidated Bitcoin</span>
        </figure>
      </div>
    </section>
  );
}
