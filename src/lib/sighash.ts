import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import { ReclaimerError } from './errors';

/**
 * An independent BIP341 key-path signature hash.
 *
 * The reclaim flow only ever accepts SIGHASH_DEFAULT (0x00) or SIGHASH_ALL
 * (0x01) on key-path spends with no annex, so this covers exactly that subset.
 * Two reasons it exists rather than calling the library that built the PSBT:
 *
 *  1. Verification must not depend on the builder. The library that assembled
 *     the transaction is the wrong place to ask whether it is correct.
 *  2. The library recomputes every midstate hash per input, which is quadratic
 *     in the number of inputs. This computes the shared states once, so a
 *     500-input batch verifies in linear time.
 *
 * Agreement with `@scure/btc-signer`'s `preimageWitnessV1` is asserted in
 * `tests/sighash.test.ts` over real built transactions.
 */

const TAP_SIGHASH_TAG = new TextEncoder().encode('TapSighash');

class Writer {
  private chunks: Uint8Array[] = [];
  private length = 0;

  bytes(value: Uint8Array): this {
    this.chunks.push(value);
    this.length += value.length;
    return this;
  }

  u8(value: number): this {
    return this.bytes(new Uint8Array([value & 0xff]));
  }

  u32(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, true);
    return this.bytes(out);
  }

  i32(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setInt32(0, value, true);
    return this.bytes(out);
  }

  u64(value: bigint): this {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value, true);
    return this.bytes(out);
  }

  compactSize(value: number): this {
    if (value < 0xfd) return this.u8(value);
    if (value <= 0xffff) return this.bytes(new Uint8Array([0xfd, value & 0xff, (value >> 8) & 0xff]));
    if (value <= 0xffffffff) {
      const out = new Uint8Array(5);
      out[0] = 0xfe;
      new DataView(out.buffer).setUint32(1, value, true);
      return this.bytes(out);
    }
    const out = new Uint8Array(9);
    out[0] = 0xff;
    new DataView(out.buffer).setBigUint64(1, BigInt(value), true);
    return this.bytes(out);
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export function taggedHash(tag: Uint8Array, message: Uint8Array): Uint8Array {
  const tagHash = sha256(tag);
  const writer = new Writer().bytes(tagHash).bytes(tagHash).bytes(message);
  return sha256(writer.concat());
}

export type SighashInput = {
  /** Display-order txid (`ab12…`), the same order the UI and PSBT show. */
  txid: string;
  vout: number;
  amount: bigint;
  script: Uint8Array;
  sequence: number;
};

export type SighashOutput = {
  amount: bigint;
  script: Uint8Array;
};

export type TaprootSighashRequest = {
  version: number;
  lockTime: number;
  inputs: SighashInput[];
  outputs: SighashOutput[];
  inputIndex: number;
  /** BIP341 hash type: 0x00 (default) or 0x01 (all). */
  hashType: number;
};

function serializedOutputHash(outputs: SighashOutput[]): Uint8Array {
  const writer = new Writer();
  for (const output of outputs) {
    writer.u64(output.amount).compactSize(output.script.length).bytes(output.script);
  }
  return sha256(writer.concat());
}

/** The four `sha_*` midsections plus `sha_outputs`, computed once per transaction. */
export function computeSighashMidstate(
  inputs: SighashInput[],
  outputs: SighashOutput[],
): { prevouts: Uint8Array; amounts: Uint8Array; scriptPubKeys: Uint8Array; sequences: Uint8Array; outputs: Uint8Array } {
  const prevoutsWriter = new Writer();
  const amountsWriter = new Writer();
  const scriptsWriter = new Writer();
  const sequencesWriter = new Writer();

  for (const input of inputs) {
    const txidBytes = hex.decode(input.txid);
    if (txidBytes.length !== 32) {
      throw new ReclaimerError('ACCOUNTING_MISMATCH', `txid ${input.txid} is not 32 bytes.`);
    }
    // Outpoints are serialized in internal (little-endian) byte order.
    prevoutsWriter.bytes(txidBytes.slice().reverse()).u32(input.vout);
    amountsWriter.u64(input.amount);
    scriptsWriter.compactSize(input.script.length).bytes(input.script);
    sequencesWriter.u32(input.sequence);
  }

  return {
    prevouts: sha256(prevoutsWriter.concat()),
    amounts: sha256(amountsWriter.concat()),
    scriptPubKeys: sha256(scriptsWriter.concat()),
    sequences: sha256(sequencesWriter.concat()),
    outputs: serializedOutputHash(outputs),
  };
}

export function taprootKeyPathSighash(
  request: TaprootSighashRequest,
  midstate = computeSighashMidstate(request.inputs, request.outputs),
): Uint8Array {
  const { hashType, inputIndex, version, lockTime } = request;
  if (hashType !== 0x00 && hashType !== 0x01) {
    throw new ReclaimerError(
      'VERIFICATION_FAILED',
      `Only SIGHASH_DEFAULT and SIGHASH_ALL are supported, received 0x${hashType.toString(16)}.`,
    );
  }
  if (inputIndex < 0 || inputIndex >= request.inputs.length) {
    throw new ReclaimerError('VERIFICATION_FAILED', `Input index ${inputIndex} is out of range.`);
  }

  const message = new Writer()
    .u8(0x00) // epoch
    .u8(hashType)
    .i32(version)
    .u32(lockTime)
    .bytes(midstate.prevouts)
    .bytes(midstate.amounts)
    .bytes(midstate.scriptPubKeys)
    .bytes(midstate.sequences)
    .bytes(midstate.outputs)
    .u8(0x00) // spend_type: key path, no annex
    .u32(inputIndex)
    .concat();

  return taggedHash(TAP_SIGHASH_TAG, message);
}
