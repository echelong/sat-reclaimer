import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import { ReclaimerError } from '../src/lib/errors';
import { splitIntoBatches } from '../src/lib/ordinals';
import { buildSweepBatch, expectationFor } from '../src/lib/psbt';
import { decodePsbt, verifySignedPsbt } from '../src/lib/verify';
import type { BuiltBatch } from '../src/lib/types';
import { KEY_B_PRIV, ORDINALS, makeUtxos, taprootFor } from './fixtures';

const OTHER = taprootFor(KEY_B_PRIV);

function build(count: number, feeRateSatVb = 2n): BuiltBatch {
  const [batch] = splitIntoBatches(makeUtxos(count), { maxInputs: 500 });
  return buildSweepBatch({
    batch,
    ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
    destination: OTHER.address,
    feeRateSatVb,
    network: 'Signet',
  });
}

function signBatch(
  batch: BuiltBatch,
  options: {
    priv?: Uint8Array;
    skipInputs?: number[];
    /** Runs before signing, so the input set can be altered first. */
    mutateFirst?: (tx: btc.Transaction) => void;
    /** Runs after signing, to emulate a hostile wallet response. */
    mutate?: (tx: btc.Transaction) => void;
  } = {},
): string {
  const tx = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));
  options.mutateFirst?.(tx);
  const skip = new Set(options.skipInputs ?? []);
  for (let index = 0; index < tx.inputsLength; index += 1) {
    if (skip.has(index)) continue;
    tx.signIdx(options.priv ?? ORDINALS.priv, index);
  }
  options.mutate?.(tx);
  return base64.encode(tx.toPSBT(0));
}

function statusOf(report: ReturnType<typeof verifySignedPsbt>, id: string) {
  return report.checks.find((check) => check.id === id);
}

describe('decodePsbt', () => {
  it('reports exact inputs, outputs, fee and txid from the serialized PSBT', () => {
    const batch = build(4);
    const decoded = decodePsbt(batch.psbtBase64, 'Signet');

    expect(decoded.inputCount).toBe(4);
    expect(decoded.outputCount).toBe(1);
    expect(decoded.inputSats).toBe(40_000n);
    expect(decoded.outputSats + decoded.feeSats).toBe(decoded.inputSats);
    expect(decoded.unsignedTxid).toBe(batch.unsignedTxid);
    expect(decoded.inputs.map((input) => input.outpoint)).toEqual(batch.inputOutpoints);
    expect(decoded.inputs.every((input) => input.scriptType === 'tr')).toBe(true);
    expect(decoded.outputs[0].address).toBe(OTHER.address);
    expect(decoded.isFinal).toBe(false);
  });

  it('rejects garbage', () => {
    expect(() => decodePsbt('not-a-psbt', 'Signet')).toThrow(
      expect.objectContaining({ code: 'PSBT_MALFORMED' }),
    );
    expect(() => decodePsbt(base64.encode(new Uint8Array([1, 2, 3])), 'Signet')).toThrow(
      ReclaimerError,
    );
  });
});

describe('verifySignedPsbt: happy path', () => {
  it('accepts a correctly signed batch', () => {
    const batch = build(10);
    const report = verifySignedPsbt(signBatch(batch), expectationFor(batch, ORDINALS.scriptHex));

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(report.signedInputCount).toBe(10);
    expect(report.txid).toBe(batch.unsignedTxid);
    expect(report.rawTxHex).toMatch(/^[0-9a-f]+$/);
    expect(report.vsize).toBe(batch.vsize);
    expect(report.feeSats).toBe(batch.feeSats);
  });

  it('accepts a signature that uses the explicit SIGHASH_ALL flag', () => {
    const batch = build(2);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        // An explicit SIGHASH_ALL produces 65-byte signatures (64-byte sig + flag).
        for (let index = 0; index < tx.inputsLength; index += 1) {
          tx.updateInput(index, { sighashType: btc.SigHash.ALL }, true);
          tx.signIdx(ORDINALS.priv, index, [btc.SigHash.ALL]);
        }
      },
    });
    const decoded = btc.Transaction.fromPSBT(base64.decode(signed));
    expect(decoded.getInput(0).tapKeySig).toHaveLength(65);

    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));
    expect(report.ok).toBe(true);
  });
});

describe('verifySignedPsbt: refuses what a hostile or broken wallet could return', () => {
  it('detects a missing signature (partially signed PSBT)', () => {
    const batch = build(5);
    const report = verifySignedPsbt(
      signBatch(batch, { skipInputs: [0, 3] }),
      expectationFor(batch, ORDINALS.scriptHex),
    );

    expect(report.ok).toBe(false);
    expect(statusOf(report, 'signatures-present')?.ok).toBe(false);
    expect(statusOf(report, 'extractable')?.ok).toBe(false);
    expect(report.signedInputCount).toBe(3);
  });

  it('detects a correctly signed transaction for the wrong output', () => {
    // The wallet signs a real, valid Taproot key-path spend, but of a different
    // P2TR output than the app asked for. Structurally valid, still rejected.
    const batch = build(1);
    const signed = signBatch(batch, {
      priv: OTHER.priv,
      mutateFirst: (tx) => {
        tx.updateInput(
          0,
          { witnessUtxo: { script: OTHER.script, amount: 10_000n }, tapInternalKey: OTHER.pub },
          true,
        );
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));

    expect(report.ok).toBe(false);
    expect(statusOf(report, 'input-scripts')?.ok).toBe(false);
  });

  it('detects a tampered signature', () => {
    const batch = build(2);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        const signature = tx.getInput(0).tapKeySig!;
        const flipped = new Uint8Array(signature);
        flipped[10] ^= 0xff;
        tx.updateInput(0, { tapKeySig: flipped }, true);
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'signatures-valid')?.ok).toBe(false);
  });

  it('rejects a signature whose sighash type would let outputs be changed later', () => {
    const batch = build(2);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        for (let index = 0; index < tx.inputsLength; index += 1) {
          tx.updateInput(index, { sighashType: btc.SigHash.NONE_ANYONECANPAY }, true);
          tx.signIdx(ORDINALS.priv, index, [btc.SigHash.NONE_ANYONECANPAY]);
        }
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'signatures-valid')?.ok).toBe(false);
    expect(statusOf(report, 'signatures-valid')?.detail).toMatch(/sighash type/);
  });

  it('detects a changed destination', () => {
    const batch = build(2);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        // Redirect the sweep to a different, still-valid destination.
        tx.updateOutput(0, { script: ORDINALS.script }, true);
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));

    expect(report.ok).toBe(false);
    expect(statusOf(report, 'output-destination')?.ok).toBe(false);
    expect(statusOf(report, 'txid-stable')?.ok).toBe(false);
    // The signature commits to the outputs, so redirecting the sweep also
    // invalidates every signature cryptographically.
    expect(statusOf(report, 'signatures-valid')?.ok).toBe(false);
  });

  it('detects an extra output', () => {
    const batch = build(2);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        tx.addOutput({ script: ORDINALS.script, amount: 1000n }, true);
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));

    expect(report.ok).toBe(false);
    expect(statusOf(report, 'output-count')?.ok).toBe(false);
    expect(statusOf(report, 'fee')?.ok).toBe(false);
  });

  it('detects a reduced output amount', () => {
    const batch = build(2);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        tx.updateOutput(0, { amount: tx.getOutput(0).amount! - 5_000n }, true);
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));

    expect(report.ok).toBe(false);
    expect(statusOf(report, 'output-amount')?.ok).toBe(false);
    expect(statusOf(report, 'fee')?.ok).toBe(false);
    expect(statusOf(report, 'signatures-valid')?.ok).toBe(false);
  });

  it('detects an extra input', () => {
    const batch = build(2);
    const extra = makeUtxos(25)[24];
    const signed = signBatch(batch, {
      mutate: (tx) => {
        tx.addInput(
          {
            txid: hex.decode(extra.txid),
            index: 0,
            witnessUtxo: { script: ORDINALS.script, amount: 10_000n },
            tapInternalKey: ORDINALS.pub,
          },
          true,
        );
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));

    expect(report.ok).toBe(false);
    expect(statusOf(report, 'input-count')?.ok).toBe(false);
    expect(statusOf(report, 'input-outpoints')?.ok).toBe(false);
    expect(statusOf(report, 'signatures-present')?.ok).toBe(false);
  });

  it('detects a changed prevout value', () => {
    const batch = build(1);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        tx.updateInput(0, { witnessUtxo: { script: ORDINALS.script, amount: 9_999n } }, true);
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'input-values')?.ok).toBe(false);
  });

  it('detects an input that is not the connected Ordinals output', () => {
    const batch = build(1);
    const signed = signBatch(batch, {
      mutate: (tx) => {
        tx.updateInput(
          0,
          { witnessUtxo: { script: OTHER.script, amount: 10_000n }, tapInternalKey: OTHER.pub },
          true,
        );
      },
    });
    const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'input-scripts')?.ok).toBe(false);
  });

  it('reports a decode failure instead of throwing', () => {
    const batch = build(1);
    const report = verifySignedPsbt('definitely not a psbt', expectationFor(batch, ORDINALS.scriptHex));
    expect(report.ok).toBe(false);
    expect(report.checks[0].id).toBe('psbt-decodable');
    expect(report.txid).toBeNull();
  });
});
