import { describe, expect, it } from 'vitest';
import { base64 } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { parseFeeRate, replanAfterSizeRejection } from '../src/lib/sweep-session';
import { expectationFor, planSweep } from '../src/lib/psbt';
import { verifySignedPsbt } from '../src/lib/verify';
import type { ConnectedWallet } from '../src/lib/types';
import { makeUtxos, ORDINALS, OTHER_ADDRESS } from './fixtures';

const wallet: ConnectedWallet = {
  requestedNetwork: 'Signet', walletNetwork: 'Signet',
  ordinals: { address: ORDINALS.address, publicKey: ORDINALS.internalPubKeyHex, purpose: 'ordinals', addressType: 'p2tr' },
};
function plan() {
  return planSweep({ utxos: makeUtxos(4), ordinals: { address: ORDINALS.address, publicKeyHex: ORDINALS.internalPubKeyHex },
    destination: OTHER_ADDRESS, network: 'Signet', mainnetEnabled: false, feeRateSatVb: 2n, maxInputsPerBatch: 2 });
}

describe('fee input never silently changes the mining rate', () => {
  it.each(['1.4', '1.5', '2.9', '', '-1', '0', 'Infinity', 'NaN', '1e2', '1001', '9007199254740993'])('refuses %s', (value) => {
    expect(() => parseFeeRate(value)).toThrow();
  });
  it('keeps an exact whole-number rate', () => {
    expect(parseFeeRate(' 37 ')).toBe(37n);
  });
});

describe('payload fallback preserves transaction recovery', () => {
  it('repartitions only unsigned inputs, preserving destination and rate and measuring new fees', () => {
    const original = plan();
    const smaller = replanAfterSizeRejection({ sweep: original, reports: {}, wallet, mainnetEnabled: false });
    expect(smaller.batches).toHaveLength(4);
    expect(smaller.batches.flatMap((batch) => batch.utxos.map((utxo) => utxo.outpoint)))
      .toEqual(original.batches.flatMap((batch) => batch.utxos.map((utxo) => utxo.outpoint)));
    expect(smaller.destination).toBe(original.destination);
    expect(smaller.feeRateSatVb).toBe(original.feeRateSatVb);
    expect(smaller.feeSats).toBeGreaterThan(original.feeSats);
    expect(smaller.outputSats + smaller.feeSats).toBe(smaller.inputSats);
  });
  it('refuses to rebuild over an earlier signed batch and leaves its recoverable bytes intact', () => {
    const sweep = plan();
    const tx = btc.Transaction.fromPSBT(base64.decode(sweep.batches[0].psbtBase64));
    tx.sign(ORDINALS.priv);
    const report = verifySignedPsbt(base64.encode(tx.toPSBT()), expectationFor(sweep.batches[0], ORDINALS.scriptHex));
    expect(report.ok).toBe(true);
    const reports = { 0: report };
    const saved = report.rawTxHex;
    expect(() => replanAfterSizeRejection({ sweep, reports, wallet, mainnetEnabled: false })).toThrow('preserved');
    expect(reports[0].rawTxHex).toBe(saved);
    expect(sweep.batches).toHaveLength(2);
  });
  it('also preserves an earlier failed verification instead of discarding signing evidence', () => {
    const sweep = plan();
    const report = verifySignedPsbt(sweep.batches[0].psbtBase64, expectationFor(sweep.batches[0], ORDINALS.scriptHex));
    expect(report.ok).toBe(false);
    expect(() => replanAfterSizeRejection({ sweep, reports: { 0: report }, wallet, mainnetEnabled: false })).toThrow('preserved');
  });
});
