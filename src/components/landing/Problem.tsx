import { Counter } from '@/src/components/ui/Counter';
import { Reveal } from '@/src/components/ui/Reveal';

const TRADITIONAL = [
  'Inscription-bearing outputs are protected from ordinary send flows',
  'Those sats are not reachable through a normal spend',
  'Assets are managed one inscription at a time',
  'Large wallets are difficult to consolidate',
];

const RECLAIMER = [
  'Enumerate every inscription-bearing UTXO in the wallet',
  'Select all eligible outputs in one action',
  'Calculate the aggregate fee for the whole set',
  'Construct a single Bitcoin sweep sized by measurement',
  'Sign with the wallet you already use, then verify independently',
];

/**
 * SECTION — THE PROBLEM
 *
 * The comparison deliberately describes a *behaviour* (protection of
 * inscription outputs) rather than naming a competitor or claiming other tools
 * are incapable. The left column is how inscription-aware wallets generally
 * behave, which is exactly the design decision Sat Reclaimer gives the owner an
 * explicit opt-out from.
 */
export function Problem() {
  return (
    <section className="section problem" id="problem">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">The problem</span>
          <h2 className="section-title">
            Dead NFTs. <span className="hl">Live Bitcoin.</span>
          </h2>
          <p className="section-lede">
            An inscription can lose every bit of its collectible value and the satoshis underneath it
            stay exactly where they are: spendable on the Bitcoin network. Many inscription-aware
            wallets deliberately exclude those outputs from ordinary spending, because spending one
            can move the inscription with it. That protection is a sensible default — but it is still
            your bitcoin, and the decision to leave it there should be yours.
          </p>
        </div>

        <div className="compare">
          <Reveal className="compare-col">
            <div className="compare-head">
              <span className="compare-label mono">Default behaviour</span>
              <h3 className="display">Inscription-aware wallets</h3>
            </div>
            <ul className="compare-list">
              {TRADITIONAL.map((item) => (
                <li key={item}>
                  <span className="compare-mark" aria-hidden="true">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={140} className="compare-col compare-col-ours">
            <div className="compare-head">
              <span className="compare-label mono">Explicit opt-out</span>
              <h3 className="display">
                SAT<span className="logo-slash">{'//'}</span>RECLAIMER
              </h3>
            </div>
            <ul className="compare-list">
              {RECLAIMER.map((item) => (
                <li key={item}>
                  <span className="compare-mark compare-mark-ok" aria-hidden="true">
                    ▸
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <dl className="scale-band">
          <div>
            <dt>Inscriptions scanned</dt>
            <dd>
              <Counter value={1_083} />
            </dd>
          </div>
          <div>
            <dt>Unique UTXOs</dt>
            <dd>
              <Counter value={1_079} />
            </dd>
          </div>
          <div>
            <dt>Transactions required</dt>
            <dd>
              <Counter value={1} />
            </dd>
          </div>
          <div>
            <dt>Seed phrases requested</dt>
            <dd className="scale-band-zero">0</dd>
          </div>
        </dl>

        <p className="compare-foot mono">
          Figures above were measured on the wallet this tool was built against — they are not a
          claim about what any other wallet holds. An inscription-bearing UTXO is still an ordinary
          Bitcoin UTXO, and this tool does not delete inscriptions or convert them into anything.
        </p>
      </div>
    </section>
  );
}
