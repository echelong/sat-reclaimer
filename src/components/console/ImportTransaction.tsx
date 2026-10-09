'use client';

import { useRef, useState } from 'react';
import { MAX_FEE_RATE_SAT_VB } from '@/src/lib/bitcoin';
import { errorMessage } from '@/src/lib/errors';
import {
  inspectImportedTransaction,
  normalizeRawTransactionHex,
  type ImportedTransactionReport,
} from '@/src/lib/imported-transaction';
import {
  broadcastRawTransaction,
  checkTxidStatus,
  broadcastUnlockHint,
  isBroadcastAuthorised,
  type BroadcastAuthorisation,
  type BroadcastOutcome,
  type BroadcastState,
} from '@/src/lib/broadcast';
import { ACKNOWLEDGEMENT_PHRASE } from '@/src/lib/ordinals';
import type { AppNetwork } from '@/src/lib/types';

/**
 * Recover a transaction the console already saved, or any raw transaction the
 * user brings.
 *
 * This is a deliberately manual, four-step flow — load, inspect, acknowledge,
 * broadcast — and it holds to three rules:
 *
 *  1. Importing is never an approval. The authorization checkbox is bound to the
 *     txid that was just inspected and starts empty every time, so a file that
 *     was approved in an earlier session is not approved now.
 *  2. Nothing is broadcast automatically. The only submission is the explicit
 *     button, and it re-checks every guard in `src/lib/broadcast.ts`.
 *  3. What cannot be verified is stated, not glossed. A raw transaction carries
 *     no input values, so the fee is reported as unknown rather than invented.
 */
export function ImportTransaction({
  network,
  broadcastState,
  authorisation,
}: {
  network: AppNetwork;
  broadcastState: BroadcastState;
  authorisation: BroadcastAuthorisation;
}) {
  const [hexInput, setHexInput] = useState('');
  const [report, setReport] = useState<ImportedTransactionReport | null>(null);
  const [failure, setFailure] = useState('');
  const [status, setStatus] = useState('');
  const [authorizedTxid, setAuthorizedTxid] = useState('');
  const [phrase, setPhrase] = useState('');
  const [outcome, setOutcome] = useState<BroadcastOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const operationInFlight = useRef(false);

  const allowed = isBroadcastAuthorised(network, authorisation);
  const inspectionPassed = report?.ok === true;
  const phraseOk = phrase.trim().toUpperCase() === ACKNOWLEDGEMENT_PHRASE;
  const canBroadcast =
    !busy &&
    allowed &&
    inspectionPassed &&
    report !== null &&
    authorizedTxid === report.txid &&
    phraseOk &&
    !broadcastState.attempted.has(report.txid) &&
    outcome === null;

  function reset() {
    setReport(null);
    setFailure('');
    setStatus('');
    setAuthorizedTxid('');
    setPhrase('');
    setOutcome(null);
  }

  function onInspect(raw: string) {
    reset();
    if (!raw.trim()) {
      setFailure('Paste a raw transaction or choose a saved .hex file first.');
      return;
    }
    try {
      const next = inspectImportedTransaction({ rawTxHex: raw, network });
      setReport(next);
      setStatus(
        next.ok
          ? `Inspected txid ${next.txid}: ${next.inputCount} input(s), ${next.outputCount} output(s), ${next.vsize} vB. Nothing has been signed or broadcast.`
          : `Inspected txid ${next.txid}, but ${next.checks.filter((check) => !check.ok).length} local check(s) failed. Broadcasting is blocked.`,
      );
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    reset();
    try {
      const text = await file.text();
      setHexInput(text.trim());
      onInspect(text);
    } catch (error) {
      reset();
      setFailure(`Could not read the transaction file: ${errorMessage(error)}`);
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }

  async function onBroadcast() {
    if (!report || !canBroadcast || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setFailure('');
    try {
      const outcomeResult = await broadcastRawTransaction({
        rawTxHex: normalizeRawTransactionHex(report.rawTxHex),
        txid: report.txid,
        network,
        authorisation,
        // The local inspection replaces the signed-PSBT verification, and only
        // when every check it can perform passed.
        verificationPassed: report.ok,
        state: broadcastState,
      });
      setOutcome(outcomeResult);
      setStatus(
        outcomeResult.status === 'already-known'
          ? `The network already knows txid ${outcomeResult.txid}. Nothing was submitted a second time.`
          : `Accepted by ${outcomeResult.endpoint}. txid ${outcomeResult.txid}.`,
      );
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }

  async function onCheckStatus() {
    if (!report || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setFailure('');
    try {
      const result = await checkTxidStatus({ txid: report.txid, network });
      setStatus(result.detail);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="cx-panel">
      <div className="cx-step">
        <span className="cx-step-index mono">↺</span>
        <h2 className="cx-step-title">Recover a saved transaction</h2>
        <span className="cx-step-chip mono" data-on={report ? 'true' : 'false'}>
          {report ? 'Inspected' : 'Idle'}
        </span>
      </div>

      <p className="cx-note">
        If a scan was interrupted after signing, the verified transaction can be saved as a{' '}
        <code>.hex</code> file and brought back here to be submitted without signing again — that is
        the whole point of the file. A raw transaction is public network data and contains no key
        material. Importing one is not an approval: this panel inspects the bytes, states exactly
        what it cannot check, and asks for a fresh authorization before anything is submitted.
      </p>

      <div className="cx-form">
        <label className="cx-field cx-field-wide">
          <span>Raw transaction hex</span>
          <textarea
            className="mono"
            rows={3}
            value={hexInput}
            onChange={(event) => { setHexInput(event.target.value); reset(); }}
            disabled={busy}
            placeholder="020000000001…"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="cx-actions">
        <button className="btn btn-ghost" onClick={() => onInspect(hexInput)} disabled={busy}>
          Inspect transaction
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".hex,.txt,text/plain"
          onChange={onFile}
          disabled={busy}
          hidden
          aria-label="Choose a saved raw transaction file"
        />
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          Load .hex file
        </button>
      </div>

      {report && (
        <>
          <div className="cx-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={onCheckStatus}>Check confirmation</button>
          </div>
          {broadcastState.attempted.has(report.txid) && !outcome && (
            <p className="cx-note" role="status">Submission was attempted for this txid. Check confirmation; this session will not submit it again.</p>
          )}
          <dl className="cx-dl cx-dl-grid">
            <div>
              <dt>TXID</dt>
              <dd className="cx-mono cx-mono-lg">{report.txid}</dd>
            </div>
            <div>
              <dt>Inputs / outputs</dt>
              <dd className="num">
                {report.inputCount} / {report.outputCount}
              </dd>
            </div>
            <div>
              <dt>Signed inputs</dt>
              <dd className="num">{report.signedInputCount}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd className="num">
                {report.vsize} vB ({report.weight} WU)
              </dd>
            </div>
            <div>
              <dt>Destination output</dt>
              <dd className="num">{report.outputSats.toLocaleString('en-US')} sats</dd>
            </div>
            <div>
              <dt>Mining fee</dt>
              <dd className="num">cannot be verified from these bytes</dd>
            </div>
            {report.outputs.map((output) => (
              <div className="cx-dl-wide" key={output.index}>
                <dt>Output {output.index}</dt>
                <dd className="cx-mono">
                  {output.address ?? output.scriptHex}{' '}
                  <span className="cx-note-tight">({output.scriptType})</span>
                </dd>
              </div>
            ))}
            <div className="cx-dl-wide">
              <dt>First input</dt>
              <dd className="cx-mono">{report.inputs[0]?.outpoint ?? 'none'}</dd>
            </div>
          </dl>

          <ul className="cx-checks">
            {report.checks.map((check) => (
              <li key={check.id} data-ok={check.ok ? 'true' : 'false'}>
                <span aria-hidden="true">{check.ok ? '✔' : '✘'}</span>
                <span>
                  {check.label} — {check.detail}
                </span>
              </li>
            ))}
          </ul>

          <details className="cx-details" open={!report.ok}>
            <summary className="mono">What this inspection could not verify</summary>
            <ul className="cx-list cx-list-tight">
              {report.unverifiable.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>

          <p className="cx-banner" data-tone="warn" role="note">
            <span className="cx-banner-tag mono">Network</span>
            <span>
              These bytes will be submitted to {network}, the network selected above. A raw
              transaction does not record which chain it was built for, so this app cannot check that
              for you: confirm {network} is the network your wallet signed on before broadcasting. A
              node on the wrong chain rejects the transaction outright and nothing is spent.
            </span>
          </p>

          {!allowed && <p className="cx-note">{broadcastUnlockHint(network)}</p>}

          {allowed && inspectionPassed && !outcome && (
            <>
              <label className="cx-check" data-tone="warn">
                <input
                  type="checkbox"
                  checked={authorizedTxid === report.txid}
                  onChange={(event) => setAuthorizedTxid(event.target.checked ? report.txid : '')}
                  disabled={busy}
                />
                <span>
                  I authorize broadcasting this exact transaction ({report.txid}) on {network}. This
                  is a new approval for these bytes — it is not carried over from any earlier session
                  or file. It cannot be undone and nothing here will retry automatically.
                </span>
              </label>

              <label className="cx-field">
                <span>Type {ACKNOWLEDGEMENT_PHRASE} to confirm</span>
                <input
                  className="mono"
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  placeholder={ACKNOWLEDGEMENT_PHRASE}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>

              <div className="cx-actions">
                <button
                  className="btn btn-magenta"
                  onClick={onBroadcast}
                  disabled={!canBroadcast}
                  title={`Submit these exact bytes to independent ${network} nodes`}
                >
                  Broadcast imported transaction
                </button>
              </div>

              <p className="cx-note cx-note-tight">
                Unlike a transaction signed in this session, these bytes were not verified against a
                scan this app performed. Confirm the destination and the fee yourself before
                broadcasting — a raw transaction cannot prove either to this app.
              </p>
            </>
          )}

          {outcome && (
            <p className="cx-note cx-note-tight">
              <span className="tag tag-ok">
                {outcome.status === 'already-known' ? 'Already known' : 'Accepted'}
              </span>{' '}
              <span className="cx-mono">{outcome.txid}</span>{' '}
              <a className="cx-link" href={outcome.explorerUrl} target="_blank" rel="noreferrer">
                explorer ↗
              </a>
            </p>
          )}
        </>
      )}

      <div className="cx-log" aria-live="polite" aria-atomic="true">
        {status && <p className="cx-note">{status}</p>}
        {failure && (
          <p className="cx-banner" data-tone="danger">
            <span className="cx-banner-tag mono">Refused</span>
            <span>{failure}</span>
          </p>
        )}
      </div>

      <p className="cx-note cx-note-tight">
        Fee-rate ceiling for built sweeps is {MAX_FEE_RATE_SAT_VB.toString()} sat/vB; an imported
        transaction is not re-priced, it is submitted exactly as supplied or not at all.
      </p>
    </section>
  );
}
