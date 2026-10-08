'use client';

import { useMemo, useState } from 'react';
import {
  APP_NETWORKS,
  MAX_FEE_RATE_SAT_VB,
  deriveOrdinalTaproot,
  isMainnetEnabled,
  validateDestinationAddress,
} from '@/src/lib/bitcoin';
import { ReclaimerError, errorMessage } from '@/src/lib/errors';
import {
  ACKNOWLEDGEMENT_PHRASE,
  ASSET_DETECTION_LIMITATIONS,
  assertScanComplete,
  countInscriptions,
  DESTRUCTIVE_ACKNOWLEDGEMENT,
  sumSats,
} from '@/src/lib/ordinals';
import { expectationFor, planSweep, type SweepPlan } from '@/src/lib/psbt';
import { verifySignedPsbt } from '@/src/lib/verify';
import {
  broadcastRawTransaction,
  broadcastUnlockHint,
  checkTxidStatus,
  createBroadcastState,
  isBroadcastAuthorised,
  isFlagEnabled,
  type BroadcastAuthorisation,
  type BroadcastOutcome,
  type TxidStatus,
} from '@/src/lib/broadcast';
import {
  connectXverse,
  disconnectXverse,
  isWalletSizeLimitError,
  scanOrdinals,
  signPsbt,
} from '@/src/lib/xverse';
import { ImportTransaction } from '@/src/components/console/ImportTransaction';
import type {
  AppNetwork,
  BuiltBatch,
  ConnectedWallet,
  ScanResult,
  VerificationReport,
} from '@/src/lib/types';

const MAINNET_ENABLED = isMainnetEnabled(process.env.NEXT_PUBLIC_ENABLE_MAINNET);

/**
 * From this share of the recovered value upward, the miner fee stops being a
 * detail and becomes the headline. The fee is always shown before signing; this
 * threshold decides when it is shown as a warning rather than a number.
 */
const HIGH_FEE_WARNING_PERCENT = 25;

/**
 * Broadcasting is a separate operator authorization, never a side effect of
 * enabling Mainnet. Real BTC needs BOTH Mainnet flags; test chains need the
 * Signet/Testnet flag.
 */
const BROADCAST_AUTHORISATION: BroadcastAuthorisation = {
  mainnetEnabled: MAINNET_ENABLED,
  mainnetBroadcastEnabled: isFlagEnabled(process.env.NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST),
  signetBroadcastEnabled: isFlagEnabled(process.env.NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST),
};

function sats(value: bigint): string {
  return `${new Intl.NumberFormat('en-US').format(value)} sats`;
}

function feePercentOf(fee: bigint | null, input: bigint | null): string {
  if (fee === null || input === null || input <= 0n) return 'n/a';
  return `${(Number((fee * 10_000n) / input) / 100).toFixed(4)}%`;
}

function num(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Saves the verified raw transaction as a `.hex` file.
 *
 * A raw transaction is the exact byte sequence that would be relayed to the
 * public network, so it contains nothing secret — no key material, and nothing
 * that is not already broadcast to every node by definition. It is offered
 * because the console holds signed transactions in memory only: if the tab is
 * closed before broadcasting, this file is the only way to submit the verified
 * bytes without signing again. Nothing is written to disk, `localStorage` or any
 * server unless the user clicks this button.
 */
function downloadVerifiedTransaction(txid: string, rawTxHex: string) {
  const blob = new Blob([`${rawTxHex}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `sat-reclaimer-${txid}.hex`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function Reclaimer() {
  const [network, setNetwork] = useState<AppNetwork>('Signet');
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [inputScriptHex, setInputScriptHex] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selectedOutpoints, setSelectedOutpoints] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [mainnetAcknowledged, setMainnetAcknowledged] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [destination, setDestination] = useState('');
  const [feeRate, setFeeRate] = useState('2');
  const [sweep, setSweep] = useState<SweepPlan | null>(null);
  const [reports, setReports] = useState<Record<number, VerificationReport>>({});
  const [outcomes, setOutcomes] = useState<Record<number, BroadcastOutcome>>({});
  const [confirmedTxids, setConfirmedTxids] = useState<Record<number, string>>({});
  const [txidStatuses, setTxidStatuses] = useState<Record<number, TxidStatus>>({});
  const [broadcastState] = useState(createBroadcastState);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');

  const mainnetWallet = MAINNET_ENABLED && wallet?.requestedNetwork === 'Mainnet';
  const selectedSet = useMemo(() => new Set(selectedOutpoints), [selectedOutpoints]);
  const selectedUtxos = useMemo(
    () => (scan?.utxos ?? []).filter((utxo) => selectedSet.has(utxo.outpoint)),
    [scan, selectedSet],
  );
  const selectedSats = useMemo(() => sumSats(selectedUtxos), [selectedUtxos]);
  const selectedInscriptions = useMemo(() => countInscriptions(selectedUtxos), [selectedUtxos]);

  const allSelected = scan !== null && scan.utxos.length > 0 && selectedUtxos.length === scan.utxos.length;
  const canSign = phrase === ACKNOWLEDGEMENT_PHRASE && (!mainnetWallet || mainnetAcknowledged);

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
      setMainnetAcknowledged(false);
      setPhrase('');
      setSweep(null);
      setReports({});
      setOutcomes({});
      setConfirmedTxids({});
      setTxidStatuses({});
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
      setSweep(null);
      setMainnetAcknowledged(false);
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
      setSweep(null);
      setReports({});
      setOutcomes({});
      setConfirmedTxids({});
      setTxidStatuses({});
      setStatus(
        result.complete
          ? `Scan complete: ${num(result.retrievedCount)} inscriptions across ${num(result.utxos.length)} unique UTXOs in ${num(result.pagesFetched)} page(s).`
          : `Scan INCOMPLETE: retrieved ${num(result.retrievedCount)} of ${result.reportedTotal === null ? 'an unknown total' : num(result.reportedTotal)}. Sweep All is blocked until the scan finishes.`,
      );
    });
  }

  function onSweepAll() {
    if (!wallet || !inputScriptHex || !scan) return;
    void run(async () => {
      assertScanComplete(scan);
      const parsedFeeRate = Number(feeRate);
      if (!Number.isFinite(parsedFeeRate) || parsedFeeRate < 1) {
        throw new ReclaimerError('INVALID_FEE_RATE', 'Enter a fee rate of at least 1 sat/vB.');
      }
      if (BigInt(Math.round(parsedFeeRate)) > MAX_FEE_RATE_SAT_VB) {
        throw new ReclaimerError('INVALID_FEE_RATE', `Refusing a fee rate above ${MAX_FEE_RATE_SAT_VB} sat/vB.`);
      }
      const authorised = new Set(selectedOutpoints);
      const chosen = scan.utxos.filter((utxo) => authorised.has(utxo.outpoint));
      if (chosen.length === 0) {
        throw new ReclaimerError('EMPTY_BATCH', 'Select UTXOs to sweep first.');
      }
      const plan = planSweep({
        utxos: chosen,
        ordinals: { publicKeyHex: wallet.ordinals.publicKey, address: wallet.ordinals.address },
        destination,
        feeRateSatVb: BigInt(Math.round(parsedFeeRate)),
        network: wallet.requestedNetwork,
        mainnetEnabled: MAINNET_ENABLED,
      });
      setSweep(plan);
      setReports({});
      setOutcomes({});
      setConfirmedTxids({});
      setTxidStatuses({});
      setStatus(
        plan.singleTransaction
          ? `Sweep built: ${num(plan.inputCount)} UTXOs → 1 transaction → 1 destination (${num(plan.measurements[0].vsize)} vB, fee ${sats(plan.feeSats)}). Nothing signed.`
          : `Sweep built: ${num(plan.inputCount)} UTXOs → ${num(plan.batchCount)} transactions (${plan.feeSats} sats total fee). Nothing signed.`,
      );
    });
  }

  function onSign(batch: BuiltBatch) {
    if (!wallet || !inputScriptHex || !sweep) return;
    void run(async () => {
      let signed: string;
      try {
        const result = await signPsbt({
          psbtBase64: batch.psbtBase64,
          ordinalsAddress: wallet.ordinals.address,
          inputIndexes: batch.signInputIndexes,
          network: batch.network,
          mainnetEnabled: MAINNET_ENABLED,
        });
        signed = result.psbt;
      } catch (error) {
        // Xverse has a practical PSBT/signing payload limit. If one large
        // transaction is refused for a size/input reason, re-plan the same
        // wallet into the minimum number of smaller batches. No validation is
        // relaxed to make this pass.
        // Halve the largest batch and try again. This repeats as long as the
        // wallet keeps refusing a payload that is still bigger than one input,
        // so a wallet with a much lower practical limit than the relay policy
        // still reaches a single Sweep All workflow. Every re-plan rebuilds and
        // re-measures the transactions from scratch; no validation is relaxed.
        const largestBatch = sweep.batches.reduce((max, entry) => Math.max(max, entry.utxos.length), 0);
        if (isWalletSizeLimitError(error) && largestBatch > 1) {
          const smaller = Math.max(1, Math.floor(largestBatch / 2));
          const replanned = planSweep({
            utxos: sweep.batches.flatMap((entry) => entry.utxos),
            ordinals: { publicKeyHex: wallet.ordinals.publicKey, address: wallet.ordinals.address },
            destination: sweep.destination,
            feeRateSatVb: sweep.feeRateSatVb,
            network: sweep.network,
            mainnetEnabled: MAINNET_ENABLED,
            maxInputsPerBatch: smaller,
          });
          setSweep(replanned);
          setReports({});
          setOutcomes({});
          setConfirmedTxids({});
          setTxidStatuses({});
          setStatus(
            `Xverse rejected the ${num(batch.utxos.length)}-input transaction as too large. Re-planned the same ${num(replanned.inputCount)} UTXOs into ${num(replanned.batchCount)} transactions of up to ${num(smaller)} inputs each (fee ${sats(replanned.feeSats)} total). Nothing was signed. Sign batch 1 of ${num(replanned.batchCount)}.`,
          );
          return;
        }
        throw error;
      }
      const report = verifySignedPsbt(signed, expectationFor(batch, inputScriptHex));
      setReports((current) => ({ ...current, [batch.index]: report }));
      setStatus(
        report.ok
          ? `Batch ${batch.index + 1} of ${num(sweep.batchCount)}: signed PSBT verified locally (${num(report.inputCount)} inputs, ${sats(report.feeSats ?? batch.feeSats)} fee, ${num(report.vsize ?? batch.vsize)} vB).`
          : `Batch ${batch.index + 1} of ${num(sweep.batchCount)}: VERIFICATION FAILED. Do not broadcast.`,
      );
    });
  }

  function onCheckStatus(batch: BuiltBatch) {
    void run(async () => {
      const txid = reports[batch.index]?.txid;
      if (!txid) {
        throw new ReclaimerError('VERIFICATION_FAILED', 'No verified txid to look up.');
      }
      const status = await checkTxidStatus({ txid, network: batch.network });
      setTxidStatuses((current) => ({ ...current, [batch.index]: status }));
      setStatus(status.detail);
    });
  }

  function onBroadcast(batch: BuiltBatch) {
    if (!wallet) return;
    void run(async () => {
      const report = reports[batch.index];
      if (!report?.ok || !report.rawTxHex || !report.txid) {
        throw new ReclaimerError(
          'VERIFICATION_FAILED',
          'Refusing to broadcast: this batch has no verified, finalized transaction.',
        );
      }
      if (confirmedTxids[batch.index] !== report.txid) {
        throw new ReclaimerError(
          'BROADCAST_DISABLED',
          'Confirm that you authorize broadcasting this exact txid before submitting it.',
        );
      }
      const outcome = await broadcastRawTransaction({
        rawTxHex: report.rawTxHex,
        txid: report.txid,
        network: batch.network,
        authorisation: BROADCAST_AUTHORISATION,
        verificationPassed: report.ok,
        state: broadcastState,
      });
      setOutcomes((current) => ({ ...current, [batch.index]: outcome }));
      setStatus(
        outcome.status === 'already-known'
          ? `Already known: the network already has txid ${outcome.txid} (${outcome.endpoint}). ${outcome.detail}`
          : `Broadcast accepted by ${outcome.endpoint}. txid ${outcome.txid}. ${outcome.detail}`,
      );
    });
  }

  const scanChip = !scan ? 'Not scanned' : scan.complete ? 'Complete' : 'Incomplete';
  const walletChip = wallet ? `${wallet.walletType ?? 'Wallet'} · ${wallet.walletNetwork}` : 'Disconnected';

  return (
    <main className="console" id="console">
      <div className="console-wrap">
        <header className="console-head">
          <span className="kicker">Sweep All</span>
          <h1 className="console-title display">Spend the bitcoin underneath unwanted inscriptions.</h1>
          <p className="console-lede">
            Non-custodial. No seed phrase, ever. The console scans the whole wallet, plans the largest
            safe sweep, has Xverse sign it, and independently verifies the result before anything
            else can happen.
          </p>

          <dl className="console-meta">
            <div>
              <dt>Network</dt>
              <dd className="mono" data-tone={network === 'Mainnet' && MAINNET_ENABLED ? 'danger' : undefined}>
                {network === 'Mainnet' && MAINNET_ENABLED ? 'MAINNET — REAL BTC' : network}
              </dd>
            </div>
            <div>
              <dt>Wallet</dt>
              <dd className="mono">{walletChip}</dd>
            </div>
            <div>
              <dt>Scan</dt>
              <dd className="mono" data-tone={scan && !scan.complete ? 'danger' : undefined}>
                {scanChip}
              </dd>
            </div>
            <div>
              <dt>Signed</dt>
              <dd className="mono">
                {Object.values(reports).filter((report) => report.ok).length} verified
              </dd>
            </div>
          </dl>
        </header>

        {busy && (
          <div className="cx-working" role="status">
            <span className="cx-spinner" aria-hidden="true" />
            <span className="mono">
              Working — a wallet or network operation is in flight. Nothing is signed or broadcast
              without your explicit action.
            </span>
            <span className="cx-working-bar" aria-hidden="true">
              <span />
            </span>
          </div>
        )}

        <section className="cx-banner" data-tone="danger">
          <span className="cx-banner-tag mono">Destructive by design</span>
          <p>{DESTRUCTIVE_ACKNOWLEDGEMENT}</p>
        </section>

        {network === 'Mainnet' && MAINNET_ENABLED && (
          <section className="cx-banner" data-tone="danger" data-strong="true">
            <span className="cx-banner-tag mono">Mainnet — real BTC</span>
            <p>
              Real bitcoin will move. Destination is validated on Mainnet, every transaction is
              measured before signing, the signed PSBT is independently verified, and broadcasting is
              a separate explicit step.
            </p>
          </section>
        )}

        <section className="cx-panel" data-tone="quiet">
          <div className="cx-step">
            <span className="cx-step-index mono">!</span>
            <h2 className="cx-step-title">Asset detection is incomplete</h2>
          </div>
          <ul className="cx-list">
            {ASSET_DETECTION_LIMITATIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <div className="cx-grid">
          <section className="cx-panel">
            <div className="cx-step">
              <span className="cx-step-index mono">01</span>
              <h2 className="cx-step-title">Connect Xverse</h2>
              <span className="cx-step-chip mono" data-on={wallet ? 'true' : 'false'}>
                {wallet ? 'Connected' : 'Waiting'}
              </span>
            </div>

            <label className="cx-field">
              <span>Network</span>
              <select
                value={network}
                onChange={(event) => setNetwork(event.target.value as AppNetwork)}
                disabled={busy}
              >
                {APP_NETWORKS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'Mainnet'
                      ? MAINNET_ENABLED
                        ? 'MAINNET — REAL BTC'
                        : 'Mainnet (locked in code)'
                      : option}
                  </option>
                ))}
              </select>
            </label>

            <div className="cx-actions">
              <button className="btn btn-primary" onClick={onConnect} disabled={busy}>
                {wallet ? 'Reconnect Xverse' : 'Connect Xverse'}
              </button>
              {wallet && (
                <button className="btn btn-ghost" onClick={onDisconnect} disabled={busy}>
                  Disconnect
                </button>
              )}
            </div>

            {wallet ? (
              <dl className="cx-dl">
                <div>
                  <dt>Ordinals (bc1p / tb1p)</dt>
                  <dd className="cx-mono">{wallet.ordinals.address}</dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd className="cx-mono">{wallet.payment?.address ?? 'not returned'}</dd>
                </div>
                <div>
                  <dt>Wallet reports network</dt>
                  <dd className="cx-mono">{wallet.walletNetwork}</dd>
                </div>
              </dl>
            ) : (
              <p className="cx-empty">
                No wallet connected. Install a supported wallet (Xverse) for this browser, then
                connect. This app never asks for a seed phrase or private key, and it cannot sign
                anything without your approval in the wallet itself.
              </p>
            )}
          </section>

          <section className="cx-panel">
            <div className="cx-step">
              <span className="cx-step-index mono">02</span>
              <h2 className="cx-step-title">Scan the whole wallet</h2>
              <span className="cx-step-chip mono" data-on={scan?.complete ? 'true' : 'false'} data-error={scan && !scan.complete ? 'true' : 'false'}>
                {scanChip}
              </span>
            </div>

            <div className="cx-actions">
              <button className="btn btn-primary" onClick={onScan} disabled={!wallet || busy}>
                Scan all inscriptions
              </button>
            </div>

            {!wallet && <p className="cx-empty">Connect a wallet to enable the scan.</p>}

            {scan && (
              <>
                <dl className="cx-stats">
                  <div>
                    <dt>Indexer reported</dt>
                    <dd className="num">{scan.reportedTotal === null ? 'unknown' : num(scan.reportedTotal)}</dd>
                  </div>
                  <div>
                    <dt>Inscriptions retrieved</dt>
                    <dd className="num">{num(scan.retrievedCount)}</dd>
                  </div>
                  <div>
                    <dt>Unique UTXOs</dt>
                    <dd className="num">{num(scan.utxos.length)}</dd>
                  </div>
                  <div>
                    <dt>Total sats</dt>
                    <dd className="num">{num(Number(scan.grossSats))}</dd>
                  </div>
                  <div>
                    <dt>Pages read</dt>
                    <dd className="num">{num(scan.pagesFetched)}</dd>
                  </div>
                  <div>
                    <dt>Duplicates skipped</dt>
                    <dd className="num">{num(scan.duplicateIdCount)}</dd>
                  </div>
                  <div>
                    <dt>Rows with no address</dt>
                    <dd className="num" data-tone={scan.unverifiedAddressCount > 0 ? 'warn' : undefined}>
                      {num(scan.unverifiedAddressCount)}
                    </dd>
                  </div>
                </dl>

                {scan.unverifiedAddressCount > 0 && (
                  <p className="cx-note">
                    {num(scan.unverifiedAddressCount)} row(s) came back without an address, so this app
                    could not confirm from the wallet&apos;s response that they belong to your Ordinals
                    address. They are still listed and spendable: every input script is re-checked
                    against your key before signing and each signature is verified afterwards, so a
                    row that is not yours cannot produce a valid transaction.
                  </p>
                )}

                <p className={scan.complete ? 'cx-note' : 'cx-note'} data-tone={scan.complete ? undefined : 'danger'}>
                  {scan.complete
                    ? `Scan complete: all ${num(scan.retrievedCount)} inscriptions across ${num(scan.pagesFetched)} page(s) retrieved.`
                    : `Scan INCOMPLETE — retrieved ${num(scan.retrievedCount)} of ${scan.reportedTotal === null ? 'an unknown total' : num(scan.reportedTotal)}. Sweep All is blocked.`}
                </p>

                {scan.warnings.length > 0 && (
                  <ul className="cx-list">
                    {scan.warnings.map((warning, index) => (
                      <li key={`${index}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                )}

                {scan.quarantine.length > 0 && (
                  <details className="cx-details">
                    <summary className="mono">
                      {scan.quarantine.length} row(s) excluded as unusable
                    </summary>
                    <ul className="cx-list cx-list-tight">
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
          </section>
        </div>

        <section className="cx-panel">
          <div className="cx-step">
            <span className="cx-step-index mono">03</span>
            <h2 className="cx-step-title">Destructive acknowledgement</h2>
            <span className="cx-step-chip mono" data-on={acknowledged ? 'true' : 'false'}>
              {acknowledged ? 'Acknowledged' : 'Required'}
            </span>
          </div>

          <label className="cx-check">
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

          {mainnetWallet && (
            <label className="cx-check" data-tone="danger">
              <input
                type="checkbox"
                checked={mainnetAcknowledged}
                onChange={(event) => setMainnetAcknowledged(event.target.checked)}
                disabled={!scan}
              />
              <span>
                <strong>MAINNET — REAL BTC.</strong> I authorize a Mainnet sweep of real bitcoin. I
                understand this may permanently affect every inscription and asset carried by the
                selected UTXOs, and that the signed PSBT will be independently verified before
                anything else can happen.
              </span>
            </label>
          )}

          {scan && (
            <div className="cx-actions">
              <button
                className="btn btn-ghost"
                disabled={!acknowledged || busy || allSelected}
                onClick={() => setSelectedOutpoints(scan.utxos.map((utxo) => utxo.outpoint))}
              >
                Select all {num(scan.utxos.length)} UTXOs
              </button>
              <button className="btn btn-ghost" disabled={!acknowledged || busy} onClick={() => setSelectedOutpoints([])}>
                Clear selection
              </button>
            </div>
          )}

          {!acknowledged && (
            <p className="cx-note">
              {scan
                ? 'UTXOs are not selectable until you acknowledge the warning above.'
                : 'Scan the wallet first, then acknowledge the destructive warning to unlock selection.'}
            </p>
          )}
        </section>

        <section className="cx-panel">
          <div className="cx-step">
            <span className="cx-step-index mono">04</span>
            <h2 className="cx-step-title">Sweep destination</h2>
            <span className="cx-step-chip mono" data-on={destination.length > 0 ? 'true' : 'false'}>
              {destination.length > 0 ? 'Address entered' : 'No address'}
            </span>
          </div>

          <div className="cx-form">
            <label className="cx-field cx-field-wide">
              <span>Destination Bitcoin address ({wallet?.requestedNetwork ?? network})</span>
              <input
                className="mono"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="bc1q… / bc1p… / a swap BTC deposit address"
                disabled={!acknowledged}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="cx-field">
              <span>Fee rate (sat/vB)</span>
              <input
                className="mono"
                type="number"
                min={1}
                max={Number(MAX_FEE_RATE_SAT_VB)}
                value={feeRate}
                onChange={(event) => setFeeRate(event.target.value)}
              />
            </label>
          </div>

          <dl className="cx-stats">
            <div>
              <dt>Selected UTXOs</dt>
              <dd className="num">{num(selectedUtxos.length)}</dd>
            </div>
            <div>
              <dt>Inscriptions affected</dt>
              <dd className="num">{num(selectedInscriptions)}</dd>
            </div>
            <div>
              <dt>Selected value</dt>
              <dd className="num">{num(Number(selectedSats))}</dd>
            </div>
          </dl>

          <div className="cx-actions">
            <button
              className="btn btn-primary"
              onClick={onSweepAll}
              disabled={
                !wallet ||
                !scan ||
                !scan.complete ||
                !acknowledged ||
                (mainnetWallet && !mainnetAcknowledged) ||
                selectedUtxos.length === 0 ||
                destination.length === 0 ||
                busy
              }
            >
              Sweep all ({num(selectedUtxos.length)} UTXOs)
            </button>
            <button
              className="btn btn-ghost"
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

          {scan && !scan.complete && (
            <p className="cx-note" data-tone="danger">
              Sweep all is disabled until the whole wallet is retrieved.
            </p>
          )}
        </section>

        {sweep && (
          <section className="cx-panel">
            <div className="cx-step">
              <span className="cx-step-index mono">05</span>
              <h2 className="cx-step-title">Pre-sign review</h2>
              <span
                className="cx-step-chip mono"
                data-danger={sweep.network === 'Mainnet' ? 'true' : undefined}
              >
                {sweep.network === 'Mainnet' ? 'MAINNET — REAL BTC' : sweep.network}
              </span>
            </div>

            <p className="cx-headline mono">
              {sweep.singleTransaction
                ? `${num(sweep.inputCount)} UTXOs → 1 Bitcoin transaction → 1 destination`
                : `${num(sweep.inputCount)} UTXOs → ${num(sweep.batchCount)} transactions → 1 destination`}
            </p>

            {sweep.feePercent >= HIGH_FEE_WARNING_PERCENT && (
              <p className="cx-banner" data-tone="danger" data-strong="true" role="alert">
                <span className="cx-banner-tag mono">High fee</span>
                <span>
                  The Bitcoin network fee is <strong>{sweep.feePercent.toFixed(2)}%</strong> of the value
                  you are recovering: {sats(sweep.feeSats)} of {sats(sweep.inputSats)} goes to miners and{' '}
                  {sats(sweep.outputSats)} reaches your destination. That is the real cost of moving{' '}
                  {num(sweep.inputCount)} inputs at {sweep.feeRateSatVb.toString()} sat/vB — Sat Reclaimer
                  takes none of it. If that is not worth it, lower the fee rate or wait for cheaper
                  blocks, and nothing will be signed.
                </span>
              </p>
            )}

            <dl className="cx-dl cx-dl-grid">
              <div>
                <dt>Selected UTXOs</dt>
                <dd className="num">{num(sweep.inputCount)}</dd>
              </div>
              <div>
                <dt>Inscriptions affected</dt>
                <dd className="num">{num(countInscriptions(sweep.batches.flatMap((batch) => batch.utxos)))}</dd>
              </div>
              <div>
                <dt>Total input sats</dt>
                <dd className="num">{num(Number(sweep.inputSats))}</dd>
              </div>
              <div>
                <dt>Destination output sats</dt>
                <dd className="num">{num(Number(sweep.outputSats))}</dd>
              </div>
              <div>
                <dt>Fee rate</dt>
                <dd className="num">{sweep.feeRateSatVb.toString()} sat/vB</dd>
              </div>
              <div>
                <dt>Exact fee</dt>
                <dd className="num">{num(Number(sweep.feeSats))}</dd>
              </div>
              <div>
                <dt>Fee as % of recovered BTC</dt>
                <dd className="num">{sweep.feePercent.toFixed(4)}%</dd>
              </div>
              <div>
                <dt>Vsize</dt>
                <dd className="num">
                  {sweep.singleTransaction
                    ? `${num(sweep.maxVsize)} vB`
                    : `${num(sweep.maxVsize)} vB each, ${num(sweep.measurements.reduce((total, m) => total + m.vsize, 0))} vB total`}
                </dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd className="num">
                  {sweep.singleTransaction
                    ? `${num(sweep.maxWeight)} WU`
                    : `${num(sweep.maxWeight)} WU each, ${num(sweep.totalWeight)} WU total`}
                </dd>
              </div>
              <div>
                <dt>Transactions / batches</dt>
                <dd className="num">{num(sweep.batchCount)}</dd>
              </div>
              <div className="cx-dl-wide">
                <dt>Destination</dt>
                <dd className="cx-mono">{sweep.destination}</dd>
              </div>
            </dl>

            <p className="cx-note">
              Type <code>{ACKNOWLEDGEMENT_PHRASE}</code> to enable signing. Each transaction is signed,
              decoded and verified on its own. Broadcasting is a separate manual step: after a batch
              verifies you review the exact verified transaction, authorize that txid, and submit it.
              Nothing is broadcast automatically, and an ambiguous network answer is never followed by
              a resubmission.
            </p>

            <label className="cx-field">
              <span>Signing acknowledgement phrase</span>
              <input
                className="mono"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                placeholder={ACKNOWLEDGEMENT_PHRASE}
                spellCheck={false}
                autoComplete="off"
              />
            </label>

            <div className="cx-batches">
              {sweep.batches.map((batch) => {
                const report = reports[batch.index];
                const measurement = sweep.measurements[batch.index];
                return (
                  <article key={batch.index} className="cx-batch">
                    <header className="cx-batch-head">
                      <strong>
                        Batch {batch.index + 1} of {num(sweep.batchCount)}
                      </strong>
                      <span
                        className="cx-step-chip mono"
                        data-danger={batch.network === 'Mainnet' ? 'true' : undefined}
                      >
                        {batch.network === 'Mainnet' ? 'MAINNET — REAL BTC' : batch.network}
                      </span>
                    </header>

                    <dl className="cx-dl cx-dl-grid">
                      <div>
                        <dt>Inputs</dt>
                        <dd className="num">
                          {num(measurement.inputCount)} · {num(Number(measurement.inputSats))} sats
                        </dd>
                      </div>
                      <div>
                        <dt>Output</dt>
                        <dd className="num">{num(Number(measurement.outputSats))} sats</dd>
                      </div>
                      <div>
                        <dt>Fee</dt>
                        <dd className="num">
                          {num(Number(measurement.feeSats))} sats at {sweep.feeRateSatVb.toString()} sat/vB
                        </dd>
                      </div>
                      <div>
                        <dt>Weight / vsize</dt>
                        <dd className="num">
                          {num(measurement.weight)} WU / {num(measurement.vsize)} vB
                        </dd>
                      </div>
                      <div className="cx-dl-wide">
                        <dt>Unsigned txid</dt>
                        <dd className="cx-mono">{batch.unsignedTxid}</dd>
                      </div>
                    </dl>

                    {report && (
                      <p className="cx-verdict" data-ok={report.ok ? 'true' : 'false'}>
                        {report.ok ? (
                          <>
                            Verified locally: {report.signedInputCount}/{report.inputCount} signatures
                            valid, fee {num(Number(report.feeSats ?? 0n))} sats, {num(report.vsize ?? 0)} vB,
                            txid <span className="cx-mono">{report.txid}</span>
                          </>
                        ) : (
                          'Verification failed — do not broadcast.'
                        )}
                      </p>
                    )}

                    {report && (
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
                    )}

                    {report?.ok && report.rawTxHex && report.txid && (
                      <div className="cx-final">
                        <strong className="cx-final-tag mono">Final review — verified transaction</strong>
                        <dl className="cx-dl cx-dl-grid">
                          <div>
                            <dt>Input count</dt>
                            <dd className="num">{num(report.inputCount)}</dd>
                          </div>
                          <div>
                            <dt>Input sats</dt>
                            <dd className="num">{num(Number(report.inputSats ?? 0n))}</dd>
                          </div>
                          <div>
                            <dt>Output sats</dt>
                            <dd className="num">{num(Number(report.outputSats ?? 0n))}</dd>
                          </div>
                          <div>
                            <dt>Mining fee</dt>
                            <dd className="num">{num(Number(report.feeSats ?? 0n))}</dd>
                          </div>
                          <div>
                            <dt>Fee as % of input</dt>
                            <dd className="num">{feePercentOf(report.feeSats, report.inputSats)}</dd>
                          </div>
                          <div>
                            <dt>Vsize</dt>
                            <dd className="num">{num(report.vsize ?? 0)} vB</dd>
                          </div>
                          <div className="cx-dl-wide">
                            <dt>Destination</dt>
                            <dd className="cx-mono">{batch.destination}</dd>
                          </div>
                          <div className="cx-dl-wide">
                            <dt>TXID</dt>
                            <dd className="cx-mono cx-mono-lg">{report.txid}</dd>
                          </div>
                        </dl>

                        <p className="cx-note cx-note-tight">
                          This signed transaction exists only in this browser tab. Refreshing or closing
                          the tab discards it and you would sign again — your bitcoin is never at risk,
                          because an un-broadcast transaction does not exist on the network. Save the
                          verified bytes if you want to be able to submit them later without signing
                          again.
                        </p>

                        <div className="cx-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => downloadVerifiedTransaction(report.txid as string, report.rawTxHex as string)}
                            disabled={busy}
                          >
                            Download verified .hex
                          </button>
                        </div>

                        <label className="cx-check" data-tone="warn">
                          <input
                            type="checkbox"
                            checked={confirmedTxids[batch.index] === report.txid}
                            onChange={(event) =>
                              setConfirmedTxids((current) => ({
                                ...current,
                                [batch.index]: event.target.checked ? report.txid || '' : '',
                              }))
                            }
                            disabled={busy || outcomes[batch.index] !== undefined}
                          />
                          <span>
                            I authorize broadcasting this exact transaction ({report.txid}) on{' '}
                            {batch.network}. It cannot be undone and nothing here will retry
                            automatically.
                          </span>
                        </label>
                      </div>
                    )}

                    <div className="cx-actions">
                      <button className="btn btn-primary" onClick={() => onSign(batch)} disabled={busy || !canSign}>
                        {report ? 'Sign again' : 'Sign + verify'}
                      </button>
                      <button
                        className="btn btn-magenta"
                        onClick={() => onBroadcast(batch)}
                        disabled={
                          busy ||
                          !report?.ok ||
                          !report.rawTxHex ||
                          !report.txid ||
                          confirmedTxids[batch.index] !== report.txid ||
                          outcomes[batch.index] !== undefined ||
                          !isBroadcastAuthorised(batch.network, BROADCAST_AUTHORISATION)
                        }
                        title={
                          isBroadcastAuthorised(batch.network, BROADCAST_AUTHORISATION)
                            ? `Submit this verified transaction to independent ${batch.network} nodes`
                            : broadcastUnlockHint(batch.network)
                        }
                      >
                        {batch.network === 'Mainnet' ? 'Broadcast Mainnet Transaction' : 'Broadcast transaction'}
                      </button>
                      {outcomes[batch.index] && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => onCheckStatus(batch)}
                          disabled={busy}
                          title="Ask independent nodes whether this txid is in a mempool or confirmed. Never resubmits."
                        >
                          Check confirmation
                        </button>
                      )}
                    </div>

                    {!isBroadcastAuthorised(batch.network, BROADCAST_AUTHORISATION) && (
                      <p className="cx-note">{broadcastUnlockHint(batch.network)}</p>
                    )}

                    {outcomes[batch.index] && (
                      <p className="cx-note cx-note-tight">
                        <span className="tag tag-ok">
                          {outcomes[batch.index].status === 'already-known' ? 'Already known' : 'Accepted'}
                        </span>{' '}
                        <span className="cx-mono">{outcomes[batch.index].txid}</span>{' '}
                        <a
                          className="cx-link"
                          href={outcomes[batch.index].explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          explorer ↗
                        </a>
                        {outcomes[batch.index].recoveredAfterTimeout
                          ? ' (confirmed by txid lookup after an ambiguous submission response)'
                          : ''}
                      </p>
                    )}

                    {txidStatuses[batch.index] && <p className="cx-note cx-note-tight">{txidStatuses[batch.index].detail}</p>}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <ImportTransaction
          network={wallet?.requestedNetwork ?? network}
          broadcastState={broadcastState}
          authorisation={BROADCAST_AUTHORISATION}
        />

        <div className="cx-log" aria-live="polite" aria-atomic="true">
          {status && (
            <p className="cx-banner" data-tone="info">
              <span className="cx-banner-tag mono">Status</span>
              <span>{status}</span>
            </p>
          )}
          {failure && (
            <p className="cx-banner" data-tone="danger" data-strong="true">
              <span className="cx-banner-tag mono">Refused</span>
              <span>{failure}</span>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
