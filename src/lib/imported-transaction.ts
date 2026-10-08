import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import { MAX_STANDARD_TX_WEIGHT, toScureNetwork } from './bitcoin';
import { ReclaimerError, errorMessage } from './errors';
import type { AppNetwork, VerificationCheck } from './types';

/**
 * Inspection of a raw transaction the user supplies from outside this session.
 *
 * The console can save a verified transaction as a `.hex` file before
 * broadcasting. That file is public network data, and this module is how it — or
 * any other raw transaction — can be brought back in without signing again.
 *
 * What it deliberately does NOT do:
 *
 *  - It never broadcasts. Nothing in this module submits anything.
 *  - It never inherits an approval. The caller has to obtain a fresh
 *    authorization for the exact txid every time, so a file that was approved
 *    earlier is not approved now.
 *  - It never invents a fee. A raw transaction does not contain its input
 *    values, so `feeSats`, `inputSats` and every prevout script are genuinely
 *    unknown here. They are reported as `null` rather than guessed, and the
 *    unverifiable list says exactly what could not be re-checked.
 *
 * A raw transaction is also not proof of authorization: it cannot show that the
 * user reviewed or approved it, who signed it, or what was paid. Everything the
 * app *can* check from the bytes alone is checked and reported individually.
 */

export type ImportedOutput = {
  index: number;
  address: string | null;
  scriptHex: string;
  scriptType: string;
  amount: bigint;
};

export type ImportedInput = {
  index: number;
  outpoint: string;
  /** Always null: a raw transaction carries no previous-output value. */
  amount: null;
  witnessItems: number;
  signatureBytes: number;
  /** True when the witness is exactly one 64- or 65-byte BIP340 signature. */
  keyPathSignature: boolean;
};

export type ImportedTransactionReport = {
  /** True only when every locally checkable invariant holds. */
  ok: boolean;
  txid: string;
  rawTxHex: string;
  /** Always null: input values are not part of a raw transaction. */
  inputSats: null;
  /** Always null: the fee cannot be recomputed without the input values. */
  feeSats: null;
  outputSats: bigint;
  inputCount: number;
  outputCount: number;
  weight: number;
  vsize: number;
  signedInputCount: number;
  inputs: ImportedInput[];
  outputs: ImportedOutput[];
  checks: VerificationCheck[];
  /** Statements about what cannot be established from these bytes. */
  unverifiable: string[];
};

const TXID_RE = /^[0-9a-f]{64}$/;

export function normalizeRawTransactionHex(rawTxHex: string): string {
  const cleaned = rawTxHex.trim().replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
  if (!cleaned) {
    throw new ReclaimerError('BROADCAST_MALFORMED', 'Paste a raw transaction or choose a .hex file.');
  }
  if (!/^[0-9a-f]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    throw new ReclaimerError(
      'BROADCAST_MALFORMED',
      'That is not a hexadecimal raw transaction. A raw transaction is an even-length run of hex characters.',
    );
  }
  return cleaned;
}

function decodeAddressNetwork(script: Uint8Array, network: AppNetwork): string | null {
  try {
    return btc.Address(toScureNetwork(network)).encode(btc.OutScript.decode(script));
  } catch {
    return null;
  }
}

function scriptTypeOf(script: Uint8Array): string {
  try {
    return btc.OutScript.decode(script).type;
  } catch {
    return 'unknown';
  }
}

/**
 * A witness is a key-path spend when it is a single push of a 64-byte
 * (SIGHASH_DEFAULT) or 65-byte (explicit sighash) BIP340 signature. Anything
 * else — an empty witness, a script-path stack, extra elements — means the
 * transaction was not produced by this app's Taproot key-path sweep.
 */
function classifyWitness(witness: Uint8Array[] | undefined): {
  keyPathSignature: boolean;
  signatureBytes: number;
} {
  if (!witness || witness.length === 0) return { keyPathSignature: false, signatureBytes: 0 };
  const [first] = witness;
  const isSignature = first.length === 64 || first.length === 65;
  return {
    keyPathSignature: witness.length === 1 && isSignature,
    signatureBytes: isSignature ? first.length : 0,
  };
}

export function inspectImportedTransaction(args: {
  rawTxHex: string;
  network: AppNetwork;
}): ImportedTransactionReport {
  const rawTxHex = normalizeRawTransactionHex(args.rawTxHex);
  const bytes = hex.decode(rawTxHex);

  let tx: btc.Transaction;
  try {
    tx = btc.Transaction.fromRaw(bytes);
  } catch (error) {
    throw new ReclaimerError(
      'BROADCAST_MALFORMED',
      `That is not a decodable Bitcoin transaction (${errorMessage(error)}).`,
      { cause: error },
    );
  }

  const checks: VerificationCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) =>
    checks.push({ id, label, ok, detail });

  const inputs: ImportedInput[] = [];
  for (let index = 0; index < tx.inputsLength; index += 1) {
    const input = tx.getInput(index);
    const txidBytes = input.txid;
    const vout = input.index ?? 0;
    const outpoint = txidBytes ? `${hex.encode(txidBytes)}:${vout}` : `unknown:${vout}`;
    const witness = (input.finalScriptWitness as Uint8Array[] | undefined) ?? [];
    const classified = classifyWitness(witness);
    inputs.push({
      index,
      outpoint,
      amount: null,
      witnessItems: witness.length,
      signatureBytes: classified.signatureBytes,
      keyPathSignature: classified.keyPathSignature,
    });
  }

  const outputs: ImportedOutput[] = [];
  for (let index = 0; index < tx.outputsLength; index += 1) {
    const output = tx.getOutput(index);
    const script = output.script ?? new Uint8Array();
    outputs.push({
      index,
      address: decodeAddressNetwork(script, args.network),
      scriptHex: hex.encode(script),
      scriptType: scriptTypeOf(script),
      amount: output.amount ?? 0n,
    });
  }

  const outputSats = outputs.reduce((total, output) => total + output.amount, 0n);
  const signedInputCount = inputs.filter((input) => input.keyPathSignature).length;

  // `tx.weight` requires a finalizable transaction, and an unsigned or stripped
  // transaction is exactly what a user might paste in. Falling back to four
  // weight units per serialized byte yields an upper bound (it counts witness
  // bytes at the non-witness rate), and the relay-limit check below is only ever
  // decided by that bound, so a transaction can never pass it by being measured
  // optimistically.
  let weight = bytes.length * 4;
  let weightExact = false;
  try {
    if (tx.isFinal) {
      weight = tx.weight;
      weightExact = true;
    }
  } catch {
    weightExact = false;
  }
  const vsize = Math.ceil(weight / 4);

  add(
    'decodes',
    'Decodes as a Bitcoin transaction',
    true,
    `${inputs.length} input(s), ${outputs.length} output(s), ${weight} WU${weightExact ? '' : ' at most'}.`,
  );
  add(
    'has-inputs',
    'Spends at least one input',
    inputs.length > 0,
    `${inputs.length} input(s)`,
  );
  add(
    'has-outputs',
    'Pays at least one output',
    outputs.length > 0,
    `${outputs.length} output(s)`,
  );
  add(
    'finalized',
    'Every input carries a signature',
    inputs.length > 0 && inputs.every((input) => input.signatureBytes > 0),
    `${inputs.filter((input) => input.signatureBytes > 0).length} of ${inputs.length} inputs carry a signature`,
  );
  add(
    'key-path-only',
    'Every input is a single-signature Taproot key-path spend',
    inputs.length > 0 && inputs.every((input) => input.keyPathSignature),
    signedInputCount === inputs.length
      ? `all ${inputs.length} inputs are one 64/65-byte key-path signature`
      : inputs
          .filter((input) => !input.keyPathSignature)
          .map((input) => `input ${input.index} has ${input.witnessItems} witness item(s)`)
          .join('; '),
  );
  add(
    'single-output',
    'Exactly one output',
    outputs.length === 1,
    `${outputs.length} output(s)`,
  );
  add(
    'outputs-decodable',
    `Every output is a standard address on ${args.network}`,
    outputs.length > 0 && outputs.every((output) => output.address !== null),
    outputs.every((output) => output.address !== null)
      ? outputs.map((output) => `${output.address} (${output.scriptType})`).join(', ')
      : 'at least one output is not a standard single-key address (for example an OP_RETURN or a bare multisig output)',
  );
  add(
    'weight',
    `Transaction is under the ${MAX_STANDARD_TX_WEIGHT} WU relay limit`,
    weight <= MAX_STANDARD_TX_WEIGHT && weight > 0,
    `${weight} WU / ${vsize} vB${weightExact ? '' : ' (upper bound: the transaction is not finalized)'}`,
  );

  // The txid is recomputed from the exact bytes shown, so the value the user is
  // asked to authorize is derived from the artifact rather than typed or trusted.
  const txid = tx.id;
  add(
    'txid',
    'TXID is well formed',
    TXID_RE.test(txid),
    txid,
  );

  const unverifiable: string[] = [
    'The mining fee cannot be recomputed. A raw transaction does not contain the values of the outputs it spends, so the fee is unknown here. Check it in your wallet or on a block explorer before broadcasting.',
    'The input values, input scripts and the destination relationship of the original build cannot be re-checked without the signed PSBT or the previous outputs.',
    'The network cannot be determined from these bytes. A raw transaction is not bound to a chain: the same output script is a valid mainnet and testnet script, and only the address encoding differs. This console submits to the network selected above, and a node on the wrong chain rejects the transaction outright without spending anything. Confirm the network matches the wallet that signed it.',
    'Nothing here proves that you reviewed or approved this transaction, or who signed it. Importing it is not an approval, and this app never treats it as one.',
  ];
  if (outputs.length !== 1) {
    unverifiable.push(
      'This transaction does not have the single-output shape this app builds, so it was not produced by this console.',
    );
  }

  return {
    ok: checks.every((check) => check.ok),
    txid,
    rawTxHex,
    inputSats: null,
    feeSats: null,
    outputSats,
    inputCount: inputs.length,
    outputCount: outputs.length,
    weight,
    vsize,
    signedInputCount,
    inputs,
    outputs,
    checks,
    unverifiable,
  };
}
