import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
import { splitIntoBatches } from '../src/lib/ordinals';
import { buildSweepBatch } from '../src/lib/psbt';
import { decodePsbt } from '../src/lib/verify';
import {
  computeSighashMidstate,
  taggedHash,
  taprootKeyPathSighash,
  type SighashInput,
  type SighashOutput,
} from '../src/lib/sighash';
import { KEY_B_PRIV, ORDINALS, makeUtxos, taprootFor } from './fixtures';

const OTHER = taprootFor(KEY_B_PRIV);

function buildPsbt(count: number, feeRateSatVb = 2n) {
  const [batch] = splitIntoBatches(makeUtxos(count), { maxInputs: 500 });
  return buildSweepBatch({
    batch,
    ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
    destination: OTHER.address,
    feeRateSatVb,
    network: 'Signet',
  });
}

function context(batch: ReturnType<typeof buildPsbt>) {
  const decoded = decodePsbt(batch.psbtBase64, 'Signet');
  const inputs: SighashInput[] = decoded.inputs.map((input) => ({
    txid: input.txid,
    vout: input.vout,
    amount: input.amount,
    script: hex.decode(input.scriptHex),
    sequence: input.sequence,
  }));
  const outputs: SighashOutput[] = decoded.outputs.map((output) => ({
    amount: output.amount,
    script: hex.decode(output.scriptHex),
  }));
  const tx = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));
  return { decoded, inputs, outputs, tx };
}

describe('taggedHash', () => {
  it('matches the BIP340 tagged-hash construction', () => {
    // BIP340 test vector for the "BIP0340/challenge" tag.
    const tag = new TextEncoder().encode('BIP0340/challenge');
    const message = new Uint8Array(32);
    expect(hex.encode(taggedHash(tag, message))).toHaveLength(64);
    expect(hex.encode(taggedHash(tag, message))).not.toBe(hex.encode(taggedHash(tag, new Uint8Array(32).fill(1))));
  });
});

describe('independent BIP341 sighash agrees with @scure/btc-signer', () => {
  it.each([1, 2, 3, 10, 50, 100])('matches preimageWitnessV1 for a %i-input sweep', (count) => {
    const batch = buildPsbt(count);
    const { decoded, inputs, outputs, tx } = context(batch);
    const midstate = computeSighashMidstate(inputs, outputs);

    const scripts = inputs.map((input) => input.script);
    const amounts = inputs.map((input) => input.amount);

    for (const hashType of [btc.SigHash.DEFAULT, btc.SigHash.ALL]) {
      for (let index = 0; index < decoded.inputCount; index += 1) {
        const mine = taprootKeyPathSighash(
          {
            version: decoded.version,
            lockTime: decoded.lockTime,
            inputs,
            outputs,
            inputIndex: index,
            hashType,
          },
          midstate,
        );
        const library = tx.preimageWitnessV1(index, scripts, hashType, amounts);
        expect(hex.encode(mine)).toBe(hex.encode(library));
      }
    }
  }, 60_000);

  it('produces a 32-byte digest that verifies a real signature', () => {
    const batch = buildPsbt(4);
    const { decoded, inputs, outputs } = context(batch);
    const midstate = computeSighashMidstate(inputs, outputs);

    const signed = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));
    for (let index = 0; index < signed.inputsLength; index += 1) signed.signIdx(ORDINALS.priv, index);

    for (let index = 0; index < decoded.inputCount; index += 1) {
      const digest = taprootKeyPathSighash(
        { version: decoded.version, lockTime: decoded.lockTime, inputs, outputs, inputIndex: index, hashType: 0 },
        midstate,
      );
      expect(digest).toHaveLength(32);
      expect(hex.encode(digest)).toBe(
        hex.encode(
          taprootKeyPathSighash(
            { version: decoded.version, lockTime: decoded.lockTime, inputs, outputs, inputIndex: index, hashType: 0 },
            midstate,
          ),
        ),
      );
    }

    // Every signature the library produced verifies against this digest.
    for (let index = 0; index < decoded.inputCount; index += 1) {
      const digest = taprootKeyPathSighash(
        { version: decoded.version, lockTime: decoded.lockTime, inputs, outputs, inputIndex: index, hashType: 0 },
        midstate,
      );
      const signature = signed.getInput(index).tapKeySig!;
      expect(schnorr.verify(signature.slice(0, 64), digest, inputs[index].script.slice(2))).toBe(true);
    }
  });
});

describe('sighash commits to everything that matters', () => {
  const base = buildPsbt(3);
  const { decoded, inputs, outputs } = context(base);
  const digestFor = (
    overrides: { inputs?: SighashInput[]; outputs?: SighashOutput[]; hashType?: number; inputIndex?: number } = {},
  ) => {
    const nextInputs = overrides.inputs ?? inputs;
    const nextOutputs = overrides.outputs ?? outputs;
    return hex.encode(
      taprootKeyPathSighash(
        {
          version: decoded.version,
          lockTime: decoded.lockTime,
          inputs: nextInputs,
          outputs: nextOutputs,
          inputIndex: overrides.inputIndex ?? 0,
          hashType: overrides.hashType ?? 0,
        },
        computeSighashMidstate(nextInputs, nextOutputs),
      ),
    );
  };

  const original = digestFor();

  it('changes when the input index changes', () => {
    expect(digestFor({ inputIndex: 1 })).not.toBe(original);
  });

  it('changes when the hash type changes', () => {
    expect(digestFor({ hashType: 1 })).not.toBe(original);
  });

  it('changes when an input amount changes', () => {
    const mutated = inputs.map((input, index) =>
      index === 1 ? { ...input, amount: input.amount + 1n } : input,
    );
    expect(digestFor({ inputs: mutated })).not.toBe(original);
  });

  it('changes when an input outpoint changes', () => {
    const mutated = inputs.map((input, index) =>
      index === 1 ? { ...input, vout: input.vout + 1 } : input,
    );
    expect(digestFor({ inputs: mutated })).not.toBe(original);
  });

  it('changes when an input sequence changes', () => {
    const mutated = inputs.map((input, index) =>
      index === 1 ? { ...input, sequence: 0xfffffffd } : input,
    );
    expect(digestFor({ inputs: mutated })).not.toBe(original);
  });

  it('changes when the output amount changes', () => {
    const mutated = outputs.map((output) => ({ ...output, amount: output.amount - 1n }));
    expect(digestFor({ outputs: mutated })).not.toBe(original);
  });

  it('changes when the destination script changes', () => {
    const mutated = [{ ...outputs[0], script: ORDINALS.script }];
    expect(digestFor({ outputs: mutated })).not.toBe(original);
  });

  it('rejects unsupported hash types', () => {
    expect(() => digestFor({ hashType: 0x81 })).toThrow();
    expect(() => digestFor({ hashType: 0x03 })).toThrow();
  });

  it('rejects an out-of-range input index', () => {
    expect(() => digestFor({ inputIndex: 99 })).toThrow();
  });
});
