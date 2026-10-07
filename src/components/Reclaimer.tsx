'use client';

import { useMemo, useState } from 'react';
import {
  APP_NETWORKS,
  DEFAULT_MAX_INPUTS_PER_BATCH,
  HARD_MAX_INPUTS_PER_BATCH,
  MAX_FEE_RATE_SAT_VB,
  deriveOrdinalTaproot,
  isMainnetEnabled,
  validateDestinationAddress,
} from '@/src/lib/bitcoin';
import { ReclaimerError, errorMessage } from '@/src/lib/errors';
import {
  ACKNOWLEDGEMENT_PHRASE,
  ASSET_DETECTION_LIMITATIONS,
  countInscriptions,
  DESTRUCTIVE_ACKNOWLEDGEMENT,
  splitIntoBatches,
  sumSats,
} from '@/src/lib/ordinals';
import { buildSweepBatch, expectationFor } from '@/src/lib/psbt';
import { verifySignedPsbt } from '@/src/lib/verify';
import {
  BROADCAST_BUILD_FLAG,
  broadcastSignedPsbt,
  connectXverse,
  disconnectXverse,
  isBroadcastEnabled,
  scanOrdinals,
  signPsbt,
} from '@/src/lib/xverse';
import type {
  AppNetwork,
  BuiltBatch,
  ConnectedWallet,
  ScanResult,
  VerificationReport,
} from '@/src/lib/types';

const MAINNET_ENABLED = isMainnetEnabled(process.env.NEXT_PUBLIC_ENABLE_MAINNET);
const BROADCAST_ENABLED = isBroadcastEnabled(process.env.NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST);

function sats(value: bigint): string {
  return `${new Intl.NumberFormat('en-US').format(value)} sats`;
}

export function Reclaimer() {
  const [network, setNetwork] = useState<AppNetwork>('Signet');
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [inputScriptHex, setInputScriptHex] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selectedOutpoints, setSelectedOutpoints] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [destination, setDestination] = useState('');
  const [feeRate, setFeeRate] = useState('2');
  const [maxInputs, setMaxInputs] = useState(String(DEFAULT_MAX_INPUTS_PER_BATCH));
  const [batches, setBatches] = useState<BuiltBatch[]>([]);
  const [signatures, setSignatures] = useState<Record<number, string>>({});
  const [reports, setReports] = useState<Record<number, VerificationReport>>({});
  const [broadcasts, setBroadcasts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');

  const selectedSet = useMemo(() => new Set(selectedOutpoints), [selectedOutpoints]);
  const selectedUtxos = useMemo(
    () => (scan?.utxos ?? []).filter((utxo) => selectedSet.has(utxo.outpoint)),
    [scan, selectedSet],
  );
  const selectedSats = useMemo(() => sumSats(selectedUtxos), [selectedUtxos]);
  const selectedInscriptions = useMemo(() => countInscriptions(selectedUtxos), [selectedUtxos]);
  const totalFees = useMemo(() => batches.reduce((sum, batch) => sum + batch.feeSats, 0n), [batches]);
  const totalRecoverable = useMemo(
    () => batches.reduce((sum, batch) => sum + batch.outputSats, 0n),
    [batches],
  );

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    setFailure('');
    setStatus('');
    try {
      await action();
    } catch (error) {
      const hint = error instanceof ReclaimerError ? ` [${error.code}]` : '';
      setFailure(`${errorMessage(error)}${hint}`);
    } finally {
      setBusy(false);
    }
  }

  function onConnect() {
    void run(async () => {
      const connected = await connectXverse({ network, mainnetEnabled: MAINNET_ENABLED });
      const taproot = deriveOrdinalTaproot({
        publicKeyHex: connected.ordinals.publicKey,
        ordinalsAddress: connected.ordinals.address,
        network: connected.requestedNetwork,
      });
      setWallet(connected);
      setInputScriptHex(taproot.scriptHex);
      setScan(null);
      setSelectedOutpoints([]);
      setAcknowledged(false);
      setPhrase('');
      setBatches([]);
      setSignatures({});
      setReports({});
      setBroadcasts({});
      setStatus(
        `Connected to ${connected.walletType ?? 'wallet'} on ${connected.walletNetwork}. Address and public key agree.`,
      );
    });
  }

  function onDisconnect() {
    void run(async () => {
      await disconnectXverse();
      setWallet(null);
      setInputScriptHex(null);
      setScan(null);
      setSelectedOutpoints([]);
      setBatches([]);
      setStatus('Disconnected.');
    });
  }

  function onScan() {
    if (!wallet) return;
    void run(async () => {
      const result = await scanOrdinals({
        ordinalsAddress: wallet.ordinals.address,
        network: wallet.requestedNetwork,
        mainnetEnabled: MAINNET_ENABLED,
      });
      setScan(result);
      setSelectedOutpoints(result.utxos.map((utxo) => utxo.outpoint));
      setBatches([]);
      setSignatures({});
      setReports({});
      setStatus(
        `Found ${result.inscriptionCount} inscriptions across ${result.utxos.length} unique UTXOs in ${result.pagesFetched} page(s).`,
      );
    });
  }

  function onBuild() {
    if (!wallet || !inputScriptHex) return;
    void run(async () => {
      const parsedFeeRate = Number(feeRate);
      if (!Number.isFinite(parsedFeeRate) || parsedFeeRate < 1) {
        throw new ReclaimerError('INVALID_FEE_RATE', 'Enter a fee rate of at least 1 sat/vB.');
      }
      if (BigInt(Math.round(parsedFeeRate)) > MAX_FEE_RATE_SAT_VB) {
        throw new ReclaimerError(
          'INVALID_FEE_RATE',
          `Refusing a fee rate above ${MAX_FEE_RATE_SAT_VB} sat/vB.`,
        );
      }
      const parsedMaxInputs = Number(maxInputs);
      const authorised = new Set(selectedOutpoints);
      const chosen = (scan?.utxos ?? []).filter((utxo) => authorised.has(utxo.outpoint));
      const built = splitIntoBatches(chosen, { maxInputs: parsedMaxInputs }).map((batch) =>
        buildSweepBatch({
          batch,
          ordinals: { publicKeyHex: wallet.ordinals.publicKey, address: wallet.ordinals.address },
          destination,
          feeRateSatVb: BigInt(Math.round(parsedFeeRate)),
          network: wallet.requestedNetwork,
        }),
      );
      setBatches(built);
      setSignatures({});
      setReports({});
      setBroadcasts({});
      setStatus(
        `Built ${built.length} unsigned PSBT${built.length === 1 ? '' : 's'}. Nothing has been signed or broadcast.`,
      );
    });
  }

  function onSignAndVerify(batch: BuiltBatch) {
    if (!wallet || !inputScriptHex) return;
    void run(async () => {
      const result = await signPsbt({
        psbtBase64: batch.psbtBase64,
        ordinalsAddress: wallet.ordinals.address,
        inputIndexes: batch.signInputIndexes,
      });
      const report = verifySignedPsbt(result.psbt, expectationFor(batch, inputScriptHex));
      setSignatures((current) => ({ ...current, [batch.index]: result.psbt }));
      setReports((current) => ({ ...current, [batch.index]: report }));
      setStatus(
        report.ok
          ? `Batch ${batch.index + 1} of ${batch.batchCount}: signed PSBT verified locally (${report.inputCount} inputs, ${report.feeSats} sats fee, ${report.vsize} vB).`
          : `Batch ${batch.index + 1} of ${batch.batchCount}: VERIFICATION FAILED. Do not broadcast.`,
      );
    });
  }

  function onBroadcast(batch: BuiltBatch) {
    if (!wallet) return;
    void run(async () => {
      const report = reports[batch.index];
      const result = await broadcastSignedPsbt({
        psbtBase64: signatures[batch.index] ?? batch.psbtBase64,
        ordinalsAddress: wallet.ordinals.address,
        inputIndexes: batch.signInputIndexes,
        network: batch.network,
        broadcastEnabled: BROADCAST_ENABLED,
        verificationPassed: report?.ok === true,
      });
      setBroadcasts((current) => ({
        ...current,
        [batch.index]: result.txid ?? 'submitted without a txid',
      }));
      setStatus(`Broadcast requested. txid: ${result.txid ?? 'not returned'}`);
    });
  }

  const canSelect = acknowledged && scan !== null && scan.utxos.length > 0;
  const canSign = phrase === ACKNOWLEDGEMENT_PHRASE;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">SAT RECLAIMER / M1 SIGNER PROOF</p>
        <h1>Spend the bitcoin underneath unwanted inscriptions.</h1>
        <p className="lede">
          Non-custodial. No seed phrase, ever. The app builds a Taproot-input PSBT, your wallet
          signs it, and this app verifies the result before anything else can happen.
        </p>
      </section>

      <section className="panel warning">
        <strong>Destructive by design.</strong>
        <span>{DESTRUCTIVE_ACKNOWLEDGEMENT}</span>
      </section>

      <section className="panel">
        <h2>Asset detection is incomplete</h2>
        <ul className="notes">
          {ASSET_DETECTION_LIMITATIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="grid two">
        <div className="panel">
          <h2>1. Connect Xverse</h2>
          <label>
            Network
            <select
              value={network}
              onChange={(event) => setNetwork(event.target.value as AppNetwork)}
              disabled={busy}
            >
              {APP_NETWORKS.map((option) => (
                <option key={option} value={option}>
                  {option}
                  {option === 'Mainnet' && !MAINNET_ENABLED ? ' (locked in code)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button onClick={onConnect} disabled={busy}>
              {wallet ? 'Reconnect Xverse' : 'Connect Xverse'}
            </button>
            {wallet && (
              <button onClick={onDisconnect} disabled={busy} className="secondary">
                Disconnect
              </button>
            )}
          </div>
          {wallet && (
            <dl>
              <div>
                <dt>Ordinals (bc1p / tb1p)</dt>
                <dd>{wallet.ordinals.address}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{wallet.payment?.address ?? 'not returned'}</dd>
              </div>
              <div>
                <dt>Wallet reports network</dt>
                <dd>{wallet.walletNetwork}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="panel">
          <h2>2. Scan wallet</h2>
          <button onClick={onScan} disabled={!wallet || busy}>
            Scan inscription UTXOs
          </button>
          {scan && (
            <>
              <div className="stats">
                <div>
                  <span>Inscriptions</span>
                  <strong>{scan.inscriptionCount.toLocaleString('en-US')}</strong>
                </div>
                <div>
                  <span>Unique UTXOs</span>
                  <strong>{scan.utxos.length.toLocaleString('en-US')}</strong>
                </div>
                <div>
                  <span>BTC locked inside</span>
                  <strong>{sats(scan.grossSats)}</strong>
                </div>
              </div>
              <p className="muted">
                {scan.pagesFetched} page(s) read
                {scan.reportedTotal === null ? '' : `, indexer reported ${scan.reportedTotal}`}
                {scan.truncated ? ' — scan was truncated by a safety limit, results are incomplete.' : ''}
              </p>
              {scan.quarantine.length > 0 && (
                <details className="quarantine">
                  <summary>
                    {scan.quarantine.length} row(s) excluded as unusable
                  </summary>
                  <ul className="notes">
                    {scan.quarantine.slice(0, 25).map((entry, index) => (
                      <li key={`${entry.reason}-${index}`}>
                        <code>{entry.reason}</code> {entry.detail}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>3. Destructive acknowledgement</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => {
              setAcknowledged(event.target.checked);
              if (!event.target.checked) setSelectedOutpoints([]);
            }}
            disabled={!scan}
          />
          <span>{DESTRUCTIVE_ACKNOWLEDGEMENT}</span>
        </label>
        {scan && (
          <div className="row">
            <button
              className="secondary"
              disabled={!canSelect || busy}
              onClick={() => setSelectedOutpoints(scan.utxos.map((utxo) => utxo.outpoint))}
            >
              Select all {scan.utxos.length} UTXOs
            </button>
            <button className="secondary" disabled={!canSelect || busy} onClick={() => setSelectedOutpoints([])}>
              Clear selection
            </button>
          </div>
        )}
        {!acknowledged && <p className="muted">UTXOs are not selectable until you acknowledge.</p>}
      </section>

      <section className="panel">
        <h2>4. Build the sweep</h2>
        <div className="formGrid">
          <label className="wide">
            Destination Bitcoin address ({wallet?.requestedNetwork ?? network})
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="bc1q… / bc1p… / a swap BTC deposit address"
              disabled={!acknowledged}
            />
          </label>
          <label>
            Fee rate (sat/vB)
            <input
              type="number"
              min={1}
              max={Number(MAX_FEE_RATE_SAT_VB)}
              value={feeRate}
              onChange={(event) => setFeeRate(event.target.value)}
            />
          </label>
          <label>
            Max inputs per batch
            <input
              type="number"
              min={1}
              max={HARD_MAX_INPUTS_PER_BATCH}
              value={maxInputs}
              onChange={(event) => setMaxInputs(event.target.value)}
            />
          </label>
        </div>

        <div className="stats">
          <div>
            <span>Selected UTXOs</span>
            <strong>{selectedUtxos.length.toLocaleString('en-US')}</strong>
          </div>
          <div>
            <span>Inscriptions affected</span>
            <strong>{selectedInscriptions.toLocaleString('en-US')}</strong>
          </div>
          <div>
            <span>Selected value</span>
            <strong>{sats(selectedSats)}</strong>
          </div>
        </div>

        <div className="row">
          <button
            onClick={onBuild}
            disabled={
              !wallet || !acknowledged || selectedUtxos.length === 0 || destination.length === 0 || busy
            }
          >
            Build unsigned PSBTs
          </button>
          <button
            className="secondary"
            disabled={!wallet || destination.length === 0 || busy}
            onClick={() => {
              if (!wallet) return;
              try {
                const validated = validateDestinationAddress(destination, wallet.requestedNetwork);
                setStatus(`Destination validates as a ${validated.scriptType} output on ${wallet.requestedNetwork}.`);
                setFailure('');
              } catch (error) {
                setFailure(errorMessage(error));
              }
            }}
          >
            Validate destination only
          </button>
        </div>

        {batches.length > 0 && (
          <div className="summary">
            <span>Gross {sats(sumSats(selectedUtxos))}</span>
            <span>Estimated fee {sats(totalFees)}</span>
            <strong>Recoverable {sats(totalRecoverable)}</strong>
          </div>
        )}
      </section>

      {batches.length > 0 && (
        <section className="panel">
          <h2>5. Review, sign, verify</h2>
          <p className="muted">
            Type <code>{ACKNOWLEDGEMENT_PHRASE}</code> to enable signing. Each batch is signed,
            decoded and verified on its own.
          </p>
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            placeholder={ACKNOWLEDGEMENT_PHRASE}
          />
          <div className="batchList">
            {batches.map((batch) => {
              const report = reports[batch.index];
              return (
                <article key={batch.index} className="batch">
                  <div>
                    <strong>
                      Batch {batch.index + 1} of {batch.batchCount}
                    </strong>
                    <span>
                      Signing {batch.utxos.length} inscription-bearing Taproot inputs ·{' '}
                      {batch.inscriptionCount} inscriptions · {batch.vsize} vB
                    </span>
                    <span>
                      In {sats(batch.inputSats)} → out {sats(batch.outputSats)} · fee{' '}
                      {sats(batch.feeSats)} at {batch.feeRateSatVb.toString()} sat/vB
                    </span>
                    <span className="mono">destination {batch.destination}</span>
                    <span className="mono">unsigned txid {batch.unsignedTxid}</span>
                    {report && (
                      <span className={report.ok ? 'verdict ok' : 'verdict bad'}>
                        {report.ok
                          ? `Verified locally: ${report.signedInputCount}/${report.inputCount} signatures valid, fee ${report.feeSats} sats, ${report.vsize} vB, txid ${report.txid}`
                          : 'Verification failed — do not broadcast.'}
                      </span>
                    )}
                    {report && (
                      <ul className="checks">
                        {report.checks.map((check) => (
                          <li key={check.id} className={check.ok ? 'ok' : 'bad'}>
                            {check.ok ? '✔' : '✘'} {check.label} — {check.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="actions">
                    <button onClick={() => onSignAndVerify(batch)} disabled={busy || !canSign}>
                      {report ? 'Sign again' : 'Sign + verify'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => onBroadcast(batch)}
                      disabled={busy || !report?.ok || !BROADCAST_ENABLED}
                      title={
                        BROADCAST_ENABLED
                          ? 'Broadcast this verified batch'
                          : `Disabled. Build with ${BROADCAST_BUILD_FLAG}=true to enable Signet/Testnet broadcast.`
                      }
                    >
                      Broadcast
                    </button>
                    {broadcasts[batch.index] && <span className="mono">txid {broadcasts[batch.index]}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {status && <p className="status">{status}</p>}
      {failure && <p className="status error">{failure}</p>}
    </main>
  );
}
