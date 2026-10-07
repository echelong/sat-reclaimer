import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import {
  MAX_STANDARD_TX_WEIGHT,
  estimateSweepWeight,
  vsizeFor,
} from '../src/lib/bitcoin';
import { ReclaimerError } from '../src/lib/errors';
import { splitIntoBatches } from '../src/lib/ordinals';
import { buildSweepBatch, expectationFor, signPsbtRequestFor } from '../src/lib/psbt';
import { verifySignedPsbt } from '../src/lib/verify';
import { makeUtxo, makeUtxos, taprootFor, KEY_A_PRIV, KEY_B_PRIV, OTHER_ADDRESS, ORDINALS } from './fixtures';

const OTHER = taprootFor(KEY_B_PRIV);

function buildFor(utxos: ReturnType<typeof makeUtxo>[], options: {
  destination?: string;
  feeRateSatVb?: bigint;
  publicKeyHex?: string;
  address?: string;
  maxInputs?: number;
} = {}) {
  const batches = splitIntoBatches(utxos, { maxInputs: options.maxInputs ?? 500 });
  return batches.map((batch) =>
    buildSweepBatch({
      batch,
      ordinals: {
        publicKeyHex: options.publicKeyHex ?? ORDINALS.internalPubKeyHex,
        address: options.address ?? ORDINALS.address,
      },
      destination: options.destination ?? OTHER.address,
      feeRateSatVb: options.feeRateSatVb ?? 2n,
      network: 'Signet',
    }),
  );
}

function signWith(psbtBase64: string, priv: Uint8Array): string {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbtBase64));
  for (let index = 0; index < tx.inputsLength; index += 1) {
    if (!tx.signIdx(priv, index)) throw new Error(`fixture could not sign input ${index}`);
  }
  return base64.encode(tx.toPSBT(0));
}

describe('Taproot sweep construction', () => {
  it('builds one output that conserves every sat', () => {
    const utxos = makeUtxos(3, 10_000n);
    const [batch] = buildFor(utxos);

    expect(batch.utxos).toHaveLength(3);
    expect(batch.inputSats).toBe(30_000n);
    expect(batch.inputSats).toBe(batch.outputSats + batch.feeSats);
    expect(batch.grossSats).toBe(30_000n);
    expect(batch.outputSats).toBe(30_000n - batch.feeSats);
    expect(batch.signInputIndexes).toEqual([0, 1, 2]);
    expect(batch.inputOutpoints).toEqual(utxos.map((utxo) => utxo.outpoint));
  });

  it('charges exactly vsize x fee rate', () => {
    for (const feeRate of [1n, 2n, 7n, 31n, 250n]) {
      const [batch] = buildFor(makeUtxos(10, 1_000_000n), { feeRateSatVb: feeRate });
      expect(batch.vsize).toBe(vsizeFor(batch.weight));
      expect(batch.feeSats).toBe(BigInt(batch.vsize) * feeRate);
      expect(batch.feeRateSatVb).toBe(feeRate);
    }
  });

  it('produces inputs the wallet can identify as its own Taproot outputs', () => {
    const [batch] = buildFor(makeUtxos(2));
    const tx = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));

    for (let index = 0; index < tx.inputsLength; index += 1) {
      const input = tx.getInput(index);
      expect(hex.encode(input.tapInternalKey!)).toBe(ORDINALS.internalPubKeyHex);
      expect(hex.encode(input.witnessUtxo!.script)).toBe(ORDINALS.scriptHex);
      expect(batch.outputScriptHex).toBe(OTHER.scriptHex);
    }
  });

  it('sets no sighash type, so inputs use the BIP341 default', () => {
    const [batch] = buildFor(makeUtxos(2));
    const tx = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));
    expect(tx.getInput(0).sighashType).toBeUndefined();
  });

  it('does not silently rewrite the destination', () => {
    const [batch] = buildFor(makeUtxos(1), { destination: `  ${OTHER.address}  ` });
    expect(batch.destination).toBe(OTHER.address);
  });

  it('accepts a 33-byte compressed public key', () => {
    const compressed = `02${ORDINALS.internalPubKeyHex}`;
    const batches = buildFor(makeUtxos(1), { publicKeyHex: compressed });
    expect(batches).toHaveLength(1);
    expect(batches[0].inputOutpoints).toHaveLength(1);
  });

  it('keeps the exact measured weight of a P2TR key-path input', () => {
    for (const count of [1, 2, 3, 10]) {
      const [batch] = buildFor(makeUtxos(count), { destination: OTHER.address });
      // 1 input + 1 P2TR output = 444 WU; each extra input adds exactly 230 WU.
      expect(batch.weight).toBe(444 + (count - 1) * 230);
      expect(estimateSweepWeight(count, 34)).toBe(batch.weight);
    }
  });
});

describe('M1 signing ladder (local test key, no live wallet)', () => {
  it.each([1, 10, 50, 100, 200, 500])(
    'builds, signs and verifies a %i-input batch with exact accounting',
    (count) => {
      const utxos = makeUtxos(count, 10_000n);
      const [batch] = buildFor(utxos);
      expect(batch.utxos).toHaveLength(count);
      expect(batch.weight).toBeLessThanOrEqual(MAX_STANDARD_TX_WEIGHT);
      expect(batch.signInputIndexes).toHaveLength(count);
      expect(batch.inputSats).toBe(BigInt(count) * 10_000n);
      expect(batch.inputSats).toBe(batch.outputSats + batch.feeSats);

      const signed = signWith(batch.psbtBase64, ORDINALS.priv);
      const report = verifySignedPsbt(signed, expectationFor(batch, ORDINALS.scriptHex));

      expect(report.checks.filter((check) => !check.ok)).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.inputCount).toBe(count);
      expect(report.signedInputCount).toBe(count);
      expect(report.inputSats).toBe(batch.inputSats);
      expect(report.feeSats).toBe(batch.feeSats);
      expect(report.outputSats).toBe(batch.outputSats);

      // The estimate the user approved must equal the transaction that was
      // actually produced and signed.
      const finalized = btc.Transaction.fromPSBT(base64.decode(signed));
      for (let index = 0; index < finalized.inputsLength; index += 1) finalized.finalizeIdx(index);
      expect(finalized.weight).toBe(batch.weight);
      expect(finalized.vsize).toBe(batch.vsize);
      expect(finalized.fee).toBe(batch.feeSats);
    },
    30_000,
  );

  it('splits a 900+ UTXO wallet and stays buildable batch by batch', () => {
    const utxos = makeUtxos(901, 5_000n);
    const batches = splitIntoBatches(utxos, { maxInputs: 200 });
    expect(batches).toHaveLength(5);

    let totalIn = 0n;
    let totalOut = 0n;
    let totalFee = 0n;

    for (const batch of batches) {
      const built = buildSweepBatch({
        batch,
        ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
        destination: OTHER.address,
        feeRateSatVb: 3n,
        network: 'Signet',
      });
      totalIn += built.inputSats;
      totalOut += built.outputSats;
      totalFee += built.feeSats;

      const report = verifySignedPsbt(
        signWith(built.psbtBase64, ORDINALS.priv),
        expectationFor(built, ORDINALS.scriptHex),
      );
      expect(report.ok).toBe(true);
      expect(built.inputOutpoints).toEqual(batch.utxos.map((utxo) => utxo.outpoint));
    }

    expect(totalIn).toBe(901n * 5_000n);
    expect(totalIn).toBe(totalOut + totalFee);
  }, 180_000);
});

describe('builder refusals', () => {
  it('rejects an empty batch', () => {
    expect(() => buildFor([])).not.toThrow();
    expect(() =>
      buildSweepBatch({
        batch: { index: 0, batchCount: 1, utxos: [], inscriptionCount: 0, grossSats: 0n, weight: 0, vsize: 0 },
        ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
        destination: OTHER.address,
        feeRateSatVb: 2n,
        network: 'Signet',
      }),
    ).toThrow(ReclaimerError);
  });

  it('rejects duplicate txid:vout inputs', () => {
    const utxo = makeUtxo(1);
    const batches = splitIntoBatches([utxo, utxo], { maxInputs: 10 });
    expect(() =>
      buildSweepBatch({
        batch: { ...batches[0], utxos: [utxo, utxo] },
        ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
        destination: OTHER.address,
        feeRateSatVb: 2n,
        network: 'Signet',
      }),
    ).toThrow(/Duplicate|duplicate|unique/);
  });

  it('rejects fee rates outside the safety range', () => {
    expect(() => buildFor(makeUtxos(1), { feeRateSatVb: 0n })).toThrow(
      expect.objectContaining({ code: 'INVALID_FEE_RATE' }),
    );
    expect(() => buildFor(makeUtxos(1), { feeRateSatVb: 100_000n })).toThrow(
      expect.objectContaining({ code: 'INVALID_FEE_RATE' }),
    );
  });

  it('refuses to burn the batch when the remainder is below the dust threshold', () => {
    expect(() => buildFor([makeUtxo(1, { amount: 400n }), makeUtxo(2, { amount: 400n })]))
      .toThrow(expect.objectContaining({ code: 'FEE_EXCEEDS_VALUE' }));
  });

  it('refuses a destination on the wrong network', () => {
    const mainnetAddress = taprootFor(KEY_A_PRIV, btc.NETWORK).address;
    expect(() => buildFor(makeUtxos(1), { destination: mainnetAddress })).toThrow(
      expect.objectContaining({ code: 'INVALID_DESTINATION' }),
    );
  });

  it('refuses a destination with a broken checksum', () => {
    const broken = `${OTHER.address.slice(0, -1)}${OTHER.address.endsWith('q') ? 'p' : 'q'}`;
    expect(() => buildFor(makeUtxos(1), { destination: broken })).toThrow(
      expect.objectContaining({ code: 'INVALID_DESTINATION' }),
    );
  });

  it('refuses an ordinals public key that does not match the ordinals address', () => {
    expect(() => buildFor(makeUtxos(1), { address: OTHER_ADDRESS })).toThrow(
      expect.objectContaining({ code: 'ORDINALS_KEY_MISMATCH' }),
    );
  });

  it('refuses a non-Taproot ordinals address', () => {
    const p2wpkhAddress = btc.getAddress('wpkh', ORDINALS.priv, btc.TEST_NETWORK);
    expect(() => buildFor(makeUtxos(1), { address: p2wpkhAddress })).toThrow(
      expect.objectContaining({ code: 'ORDINALS_ADDRESS_MISSING' }),
    );
  });

  it('refuses a malformed public key', () => {
    expect(() => buildFor(makeUtxos(1), { publicKeyHex: 'zz' })).toThrow(
      expect.objectContaining({ code: 'ORDINALS_KEY_INVALID' }),
    );
    expect(() => buildFor(makeUtxos(1), { publicKeyHex: 'aabb' })).toThrow(
      expect.objectContaining({ code: 'ORDINALS_KEY_INVALID' }),
    );
    expect(() => buildFor(makeUtxos(1), { publicKeyHex: '04'.repeat(33) })).toThrow(
      expect.objectContaining({ code: 'ORDINALS_KEY_INVALID' }),
    );
  });
});

describe('signPsbt request shape', () => {
  it('asks the wallet to sign exactly the ordinal inputs and never to broadcast', () => {
    const [batch] = buildFor(makeUtxos(50));
    const request = signPsbtRequestFor(batch, ORDINALS.address);

    expect(request.broadcast).toBe(false);
    expect(request.psbt).toBe(batch.psbtBase64);
    expect(Object.keys(request.signInputs)).toEqual([ORDINALS.address]);
    expect(request.signInputs[ORDINALS.address]).toEqual(
      Array.from({ length: 50 }, (_, index) => index),
    );
  });
});
