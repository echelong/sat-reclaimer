import { Reveal } from '@/src/components/ui/Reveal';

type Item = { q: string; a: React.ReactNode };

/**
 * SECTION — FAQ
 *
 * Native `<details name="faq">` gives keyboard-accessible, exclusive accordion
 * behaviour with zero JavaScript — no client bundle, no hydration cost, and it
 * degrades to a fully expanded list in any browser that does not support the
 * `name` attribute. Answers state limits (undetectable assets, wallet support,
 * lost signing state) rather than smoothing them over.
 */
const ITEMS: Item[] = [
  {
    q: 'What is Sat Reclaimer?',
    a: (
      <p>
        A non-custodial web app that lets you deliberately spend the Bitcoin held inside
        inscription-bearing Taproot UTXOs. It connects to a supported wallet, enumerates your
        inscription outputs, builds a Bitcoin transaction that sweeps them to an address you choose,
        has your wallet sign it, verifies the signed result independently of the code that built it,
        and lets you broadcast it as a separate, explicitly authorized step.
      </p>
    ),
  },
  {
    q: 'Why do my inscriptions contain BTC?',
    a: (
      <p>
        Every inscription output is a real Bitcoin UTXO, and a UTXO has to hold a spendable amount to
        exist at all. That amount — the postage value — is typically a few hundred to a few thousand
        sats per inscription. The satoshis are ordinary bitcoin. The inscription itself is data
        carried in the output, not a separate balance.
      </p>
    ),
  },
  {
    q: 'Do inscriptions get deleted?',
    a: (
      <p>
        No. Nothing is deleted and nothing can be deleted. The inscription&apos;s contents stay on
        chain at its genesis location forever. What changes is which output carries it and who
        controls that output. Sat Reclaimer does not and cannot erase an inscription.
      </p>
    ),
  },
  {
    q: 'Can this affect rare sats or other assets?',
    a: (
      <p>
        Yes, potentially. If an output carries Runes, BRC-20 state, or rare sat ranges, spending it
        moves whatever it carries to the destination along with the sats. Detection is also
        incomplete: the data source this app can read does not report Runes, BRC-20 balances, or rare
        sats, so the app never claims an output is safe and never infers safety from an inscription
        count. You must acknowledge this before any output becomes selectable.
      </p>
    ),
  },
  {
    q: 'Does Sat Reclaimer hold my Bitcoin?',
    a: (
      <p>
        No. There is no custody, no deposit address, no account, and no server that holds keys or
        funds. The app builds an unsigned transaction in your browser and asks your wallet to sign
        specific inputs. It never has the ability to move your bitcoin on its own.
      </p>
    ),
  },
  {
    q: 'Which wallets are supported?',
    a: (
      <p>
        Xverse, through the Sats Connect interface. You need a browser with the wallet extension
        installed. If no supported wallet is available, the app says so plainly instead of showing
        buttons that cannot work. Support is currently limited to wallets that expose a Taproot
        Ordinals address and a signing interface through Sats Connect.
      </p>
    ),
  },
  {
    q: 'What fees will I pay?',
    a: (
      <p>
        Bitcoin network fees only — miner fees, at the rate you choose. There is no application fee,
        no percentage of recovered sats, and no subscription. The exact fee, the resulting output
        amount, and the fee as a share of the recovered value are all shown before you sign, and the
        fee is re-derived from the finalized transaction during verification.
      </p>
    ),
  },
  {
    q: 'Why might reclaiming a small amount be uneconomical?',
    a: (
      <p>
        Fees scale with transaction size, and a Taproot input costs roughly 57–58 vB to spend. If
        each output holds only a few hundred sats, a high fee rate can consume most or all of the
        value. The app evaluates the whole selected set together, so a large number of small UTXOs
        can still be worth sweeping as one transaction — and it refuses to build a sweep whose
        remainder would be unspendable.
      </p>
    ),
  },
  {
    q: 'Can I select every inscription at once?',
    a: (
      <p>
        Yes. After a completed scan every discovered UTXO is selected by default, and you can clear
        or adjust the selection. If one transaction would exceed the standard weight limit, or your
        wallet rejects the payload as too large, the app re-plans the same set into the minimum
        number of transactions and presents them as Batch 1…N. No safety check is relaxed to make a
        rejection pass.
      </p>
    ),
  },
  {
    q: 'What happens if a transaction fails?',
    a: (
      <p>
        A wallet rejection means nothing was signed and nothing is broadcast. A node rejection is
        reported back to you verbatim — insufficient fee, missing inputs, conflicting inputs, policy
        rejection — and nothing is retried automatically. A submission that times out is resolved by
        looking the transaction up by its txid on independent nodes, never by resubmitting, and the
        app never signs a replacement transaction on its own.
      </p>
    ),
  },
  {
    q: 'Can I send BTC directly to a swap provider?',
    a: (
      <p>
        Yes. The destination is simply a Bitcoin address that you enter, so a swap or exchange BTC
        deposit address works like any other. Make sure the provider accepts the network you are on,
        and note that Sat Reclaimer does not integrate with, endorse, or take a fee from any
        provider — it has no idea what kind of address you typed.
      </p>
    ),
  },
  {
    q: 'Is the application free?',
    a: (
      <p>
        Yes. There is no platform fee, no percentage of recovered sats, and no paid tier. You pay the
        Bitcoin network fee and nothing else, and Sat Reclaimer never takes a cut of your bitcoin
        because it never has access to it.
      </p>
    ),
  },
  {
    q: 'What happens if I close the tab while signing?',
    a: (
      <p>
        A signed transaction lives in browser memory only, so refreshing or closing the tab discards
        it. That is a loss of convenience, not of funds: an un-broadcast transaction does not exist
        on the network and its inputs stay yours — you simply sign again. To cover it, the console
        lets you download a verified transaction as a raw <code>.hex</code> file before broadcasting,
        which is public network data and can be resubmitted independently. The app never stores
        wallet data on your device or on a server.
      </p>
    ),
  },
];

export function Faq() {
  return (
    <section className="section faq" id="faq">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">FAQ</span>
          <h2 className="section-title">
            The questions that decide <span className="hl">whether you click</span>.
          </h2>
        </div>

        <div className="faq-list">
          {ITEMS.map((item, index) => (
            <Reveal key={item.q} delay={Math.min(index, 5) * 45}>
              <details className="faq-item" name="faq">
                <summary>
                  <span className="faq-index mono">{String(index + 1).padStart(2, '0')}</span>
                  <span className="faq-q">{item.q}</span>
                  <span className="faq-chevron" aria-hidden="true">
                    <span />
                  </span>
                </summary>
                <div className="faq-a">{item.a}</div>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
