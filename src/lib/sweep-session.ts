import { MAX_FEE_RATE_SAT_VB } from './bitcoin';
import { ReclaimerError } from './errors';
import { planSweep, type SweepPlan } from './psbt';
import type { ConnectedWallet, VerificationReport } from './types';

/** The engine accepts integer rates. Never round the user's mining fee. */
export function parseFeeRate(value: string): bigint {
  if (!/^\d+$/.test(value.trim())) {
    throw new ReclaimerError('INVALID_FEE_RATE', 'Enter a whole-number fee rate in sat/vB. Fractional rates are not supported.');
  }
  const rate = BigInt(value.trim());
  if (rate < 1n || rate > MAX_FEE_RATE_SAT_VB) {
    throw new ReclaimerError('INVALID_FEE_RATE', `Enter a fee rate between 1 and ${MAX_FEE_RATE_SAT_VB} sat/vB.`);
  }
  return rate;
}

/** Repartition only a completely unsigned plan; signed bytes remain recoverable. */
export function replanAfterSizeRejection(args: {
  sweep: SweepPlan;
  reports: Record<number, VerificationReport>;
  wallet: ConnectedWallet;
  mainnetEnabled: boolean;
}): SweepPlan {
  if (Object.keys(args.reports).length > 0) {
    throw new ReclaimerError(
      'WALLET_ERROR',
      'Xverse rejected this batch as too large. Earlier signed batches have been preserved. Save their verified .hex files and resolve any submitted transaction before starting a fresh scan; this plan will not be repartitioned over those inputs.',
    );
  }
  const largest = Math.max(...args.sweep.batches.map((batch) => batch.utxos.length));
  if (largest <= 1) {
    throw new ReclaimerError('WALLET_ERROR', 'Xverse rejected a single-input batch. Update or reconnect the wallet; no smaller batch is possible.');
  }
  return planSweep({
    utxos: args.sweep.batches.flatMap((batch) => batch.utxos),
    ordinals: { publicKeyHex: args.wallet.ordinals.publicKey, address: args.wallet.ordinals.address },
    destination: args.sweep.destination,
    feeRateSatVb: args.sweep.feeRateSatVb,
    network: args.sweep.network,
    mainnetEnabled: args.mainnetEnabled,
    maxInputsPerBatch: Math.max(1, Math.floor(largest / 2)),
  });
}
