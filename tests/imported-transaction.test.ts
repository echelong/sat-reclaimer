import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import {
  inspectImportedTransaction,
  normalizeRawTransactionHex,
} from '../src/lib/imported-transaction';
import { ReclaimerError } from '../src/lib/errors';
import { splitIntoBatches } from '../src/lib/ordinals';
import { buildSweepBatch, expectationFor } from '../src/lib/psbt';
import { verifySignedPsbt } from '../src/lib/verify';
import { KEY_A_PRIV, KEY_B_PRIV, ORDINALS, makeUtxos, taprootFor } from './fixtures';

const OTHER = taprootFor(KEY_B_PRIV);

function signedRaw(count = 3): { rawTxHex: string; txid: string } {
  const [batch] = splitIntoBatches(makeUtxos(count), { maxInputs: 500 });
  const built = buildSweepBatch({
    batch,
    ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
    destination: OTHER.address,
    feeRateSatVb: 2n,
    network: 'Signet',
  });
  const tx = btc.Transaction.fromPSBT(base64.decode(built.psbtBase64));
  for (let index = 0; index < tx.inputsLength; index += 1) tx.signIdx(ORDINALS.priv, index);
  const signed = base64.encode(tx.toPSBT(0));
  const report = verifySignedPsbt(signed, expectationFor(built, ORDINALS.scriptHex));
  if (!report.ok || !report.rawTxHex) throw new Error('fixture could not produce a verified transaction');
  return { rawTxHex: report.rawTxHex, txid: report.txid as string };
}

describe('raw transaction input normalization', () => {
  it('accepts whitespace, newlines and an 0x prefix', () => {
    expect(normalizeRawTransactionHex('  0xAB\nCD\tEF  ')).toBe('abcdef');
  });

  it('rejects anything that is not even-length hexadecimal', () => {
    for (const bad of ['', '   ', 'zz', 'abc']) {
      expect(() => normalizeRawTransactionHex(bad)).toThrow(ReclaimerError);
    }
  });
});

describe('inspectImportedTransaction', () => {
  it('accepts a transaction this app signed and verified', () => {
    const { rawTxHex, txid } = signedRaw(3);
    const report = inspectImportedTransaction({ rawTxHex, network: 'Signet' });

    expect(report.ok).toBe(true);
    expect(report.txid).toBe(txid);
    expect(report.inputCount).toBe(3);
    expect(report.outputCount).toBe(1);
    expect(report.signedInputCount).toBe(3);
    expect(report.outputs[0].address).toBe(OTHER.address);
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it('never invents a fee or an input total', () => {
    const { rawTxHex } = signedRaw(3);
    const report = inspectImportedTransaction({ rawTxHex, network: 'Signet' });

    // A raw transaction does not carry prevout values, so these are genuinely
    // unknown and are reported as unknown rather than guessed.
    expect(report.feeSats).toBeNull();
    expect(report.inputSats).toBeNull();
    expect(report.inputs.every((input) => input.amount === null)).toBe(true);
    expect(report.unverifiable.join(' ')).toContain('cannot be recomputed');
  });

  it('states that importing is not an approval', () => {
    const { rawTxHex } = signedRaw(1);
    const report = inspectImportedTransaction({ rawTxHex, network: 'Signet' });
    expect(report.unverifiable.join(' ')).toContain('not an approval');
  });

  it('flags a stripped transaction as unfinalized', () => {
    // A legacy-encoded transaction of the same shape has no witness data at all,
    // so nothing proves an input was ever signed.
    const noWitness = inspectImportedTransaction({
      rawTxHex:
        '02000000' +
        '01' +
        '11'.repeat(32) +
        '00000000' +
        '00' +
        'ffffffff' +
        '01' +
        'e803000000000000' +
        '16' +
        '0014' +
        '00'.repeat(20) +
        '00000000',
      network: 'Signet',
    });
    expect(noWitness.ok).toBe(false);
    expect(noWitness.checks.find((check) => check.id === 'finalized')?.ok).toBe(false);
    expect(noWitness.checks.find((check) => check.id === 'key-path-only')?.ok).toBe(false);
  });

  it('rejects a multi-output transaction as not produced by this console', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: hex.decode('22'.repeat(32)),
      index: 0,
      witnessUtxo: { script: ORDINALS.script, amount: 10_000n },
      tapInternalKey: ORDINALS.pub,
    });
    tx.addOutput({ script: OTHER.script, amount: 5_000n });
    tx.addOutput({ script: OTHER.script, amount: 4_000n });
    tx.signIdx(ORDINALS.priv, 0);
    tx.finalizeIdx(0);

    const report = inspectImportedTransaction({
      rawTxHex: hex.encode(tx.extract()),
      network: 'Signet',
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'single-output')?.ok).toBe(false);
    expect(report.unverifiable.join(' ')).toContain('single-output shape');
  });

  it('reports a script-path spend as not a key-path signature', () => {
    // A two-element witness (a 64-byte element plus a 33-byte element) is a
    // script-path spend, not the single key-path signature this app produces.
    const scriptPathRaw =
      '02000000' +
      '0001' +
      '01' +
      '33'.repeat(32) +
      '00000000' +
      '00' +
      'ffffffff' +
      '01' +
      'e803000000000000' +
      '16' +
      '0014' +
      '00'.repeat(20) +
      '02' +
      '40' +
      '11'.repeat(64) +
      '21' +
      '22'.repeat(33) +
      '00000000';

    const report = inspectImportedTransaction({ rawTxHex: scriptPathRaw, network: 'Signet' });
    expect(report.checks.find((check) => check.id === 'finalized')?.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'key-path-only')?.ok).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.inputs[0].witnessItems).toBe(2);
  });

  it('refuses bytes that are not a transaction at all', () => {
    expect(() =>
      inspectImportedTransaction({ rawTxHex: 'deadbeef', network: 'Signet' }),
    ).toThrow(ReclaimerError);
  });
});

describe('network is not recoverable from raw bytes', () => {
  it('produces the identical output script on mainnet and on a test chain', () => {
    // Bitcoin output scripts carry no network: only the address encoding does.
    // This is why the imported-transaction report states that the network cannot
    // be verified rather than claiming a detection it cannot make.
    const mainnet = taprootFor(KEY_B_PRIV, btc.NETWORK);
    const testnet = taprootFor(KEY_B_PRIV, btc.TEST_NETWORK);
    expect(mainnet.scriptHex).toBe(testnet.scriptHex);
    expect(mainnet.address).not.toBe(testnet.address);
  });

  it('accepts a signature-verified Mainnet sweep when told it is Mainnet', () => {
    const mainnetOrdinals = taprootFor(KEY_A_PRIV, btc.NETWORK);
    const mainnetDest = taprootFor(KEY_B_PRIV, btc.NETWORK);
    const [batch] = splitIntoBatches(makeUtxos(3), { maxInputs: 500 });
    const built = buildSweepBatch({
      batch,
      ordinals: { publicKeyHex: mainnetOrdinals.internalPubKeyHex, address: mainnetOrdinals.address },
      destination: mainnetDest.address,
      feeRateSatVb: 1n,
      network: 'Mainnet',
      mainnetEnabled: true,
    });
    const tx = btc.Transaction.fromPSBT(base64.decode(built.psbtBase64));
    for (let index = 0; index < tx.inputsLength; index += 1) tx.signIdx(mainnetOrdinals.priv, index);
    const signed = base64.encode(tx.toPSBT(0));
    const verified = verifySignedPsbt(
      signed,
      expectationFor(built, mainnetOrdinals.scriptHex),
    );
    expect(verified.ok).toBe(true);

    const imported = inspectImportedTransaction({
      rawTxHex: verified.rawTxHex as string,
      network: 'Mainnet',
    });
    expect(imported.ok).toBe(true);
    expect(imported.unverifiable.join(' ')).toContain('network cannot be determined');
  });
});
