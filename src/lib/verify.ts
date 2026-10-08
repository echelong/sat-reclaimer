import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
import { MAX_STANDARD_TX_WEIGHT, toScureNetwork } from './bitcoin';
import { ReclaimerError, errorMessage } from './errors';
import { type SighashInput, type SighashOutput, computeSighashMidstate, taprootKeyPathSighash } from './sighash';
import type {
  AppNetwork,
  DecodedInput,
  DecodedOutput,
  DecodedPsbt,
  SignedPsbtExpectation,
  VerificationCheck,
  VerificationReport,
} from './types';

/**
 * An independent decoder for serialized PSBTs.
 *
 * Everything the app shows before and after signing is derived from this
 * decode, never from the objects that produced the transaction, so a preview
 * can never disagree with the artifact the wallet is asked to sign.
 */

function scriptTypeOf(script: Uint8Array): string {
  try {
    return btc.OutScript.decode(script).type;
  } catch {
    return 'unknown';
  }
}

export function parsePsbt(psbtBase64: string): btc.Transaction {
  let tx: btc.Transaction;
  try {
    tx = btc.Transaction.fromPSBT(base64.decode(psbtBase64));
  } catch (error) {
    throw new ReclaimerError('PSBT_MALFORMED', `Could not decode the PSBT: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  return tx;
}

/** Decode an already-parsed PSBT into the app's own view of the transaction. */
export function decodeTransaction(tx: btc.Transaction, network: AppNetwork): DecodedPsbt {
  const inputs: DecodedInput[] = [];
  for (let index = 0; index < tx.inputsLength; index += 1) {
    const input = tx.getInput(index);
    const txid = input.txid;
    const witnessUtxo = input.witnessUtxo;
    if (!txid) {
      throw new ReclaimerError('PSBT_MALFORMED', `PSBT input ${index} has no previous txid.`);
    }
    if (!witnessUtxo) {
      throw new ReclaimerError(
        'PSBT_MALFORMED',
        `PSBT input ${index} has no witness UTXO, so its value cannot be verified locally.`,
      );
    }
    const txidHex = hex.encode(txid);
    inputs.push({
      index,
      txid: txidHex,
      vout: input.index ?? 0,
      outpoint: `${txidHex}:${input.index ?? 0}`,
      amount: witnessUtxo.amount,
      scriptHex: hex.encode(witnessUtxo.script),
      scriptType: scriptTypeOf(witnessUtxo.script),
      sequence: input.sequence ?? 0xffffffff,
      hasWitnessUtxo: true,
    });
  }

  const outputs: DecodedOutput[] = [];
  for (let index = 0; index < tx.outputsLength; index += 1) {
    const output = tx.getOutput(index);
    const script = output.script ?? new Uint8Array();
    let address: string | null = null;
    try {
      address = tx.getOutputAddress(index, toScureNetwork(network)) ?? null;
    } catch {
      address = null;
    }
    outputs.push({
      index,
      amount: output.amount ?? 0n,
      scriptHex: hex.encode(script),
      address,
      scriptType: scriptTypeOf(script),
    });
  }

  const inputSats = inputs.reduce((total, input) => total + input.amount, 0n);
  const outputSats = outputs.reduce((total, output) => total + output.amount, 0n);

  return {
    inputs,
    outputs,
    inputSats,
    outputSats,
    feeSats: inputSats - outputSats,
    inputCount: inputs.length,
    outputCount: outputs.length,
    unsignedTxid: tx.id,
    version: tx.version,
    lockTime: tx.lockTime,
    isFinal: tx.isFinal,
  };
}

export function decodePsbt(psbtBase64: string, network: AppNetwork): DecodedPsbt {
  return decodeTransaction(parsePsbt(psbtBase64), network);
}

/**
 * Set equality, both directions. Checking only that every decoded outpoint is an
 * expected one is not enough: a wallet that duplicated one input and dropped
 * another would still have the same length and the same membership. Two
 * implementations of the same set is the only comparison that proves the
 * signing indexes refer to the transaction the app reviewed.
 */
function sameOutpointSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const expected = new Set(b);
  const actual = new Set(a);
  if (actual.size !== expected.size) return false;
  return a.every((outpoint) => expected.has(outpoint));
}

/** BIP341 permits 0x00 (default) and 0x01 (all). Anything else can leave
 * outputs or other inputs uncommitted, which is exactly what a hostile wallet
 * would exploit to redirect a sweep. */
const ALLOWED_SIGHASH_TYPES: ReadonlySet<number> = new Set([btc.SigHash.DEFAULT, btc.SigHash.ALL]);

type SignatureProbe = {
  index: number;
  present: boolean;
  length: number;
  hashType: number | null;
  valid: boolean;
  detail: string;
};

function probeSignature(args: {
  signature: Uint8Array | undefined;
  index: number;
  outputScript: Uint8Array;
  inputs: SighashInput[];
  outputs: SighashOutput[];
  midstate: ReturnType<typeof computeSighashMidstate>;
  version: number;
  lockTime: number;
}): SignatureProbe {
  const { index, outputScript, midstate, signature } = args;
  if (!signature) {
    return {
      index,
      present: false,
      length: 0,
      hashType: null,
      valid: false,
      detail: `Input ${index} has no Taproot key-path signature.`,
    };
  }
  const length = signature.length;
  const hashType = length === 65 ? signature[64] : 0;
  if (length !== 64 && length !== 65) {
    return {
      index,
      present: true,
      length,
      hashType,
      valid: false,
      detail: `Input ${index} carries a ${length}-byte signature, which is not a BIP340 signature.`,
    };
  }
  if (!ALLOWED_SIGHASH_TYPES.has(hashType)) {
    return {
      index,
      present: true,
      length,
      hashType,
      valid: false,
      detail: `Input ${index} was signed with sighash type 0x${hashType.toString(16)}, which would let the outputs be changed later.`,
    };
  }
  if (outputScript.length !== 34 || outputScript[0] !== 0x51 || outputScript[1] !== 0x20) {
    return {
      index,
      present: true,
      length,
      hashType,
      valid: false,
      detail: `Input ${index} does not pay a 32-byte P2TR witness program, so a key-path signature cannot be checked.`,
    };
  }
  try {
    const digest = taprootKeyPathSighash(
      {
        version: args.version,
        lockTime: args.lockTime,
        inputs: args.inputs,
        outputs: args.outputs,
        inputIndex: index,
        hashType,
      },
      midstate,
    );
    const valid = schnorr.verify(signature.slice(0, 64), digest, outputScript.slice(2));
    return {
      index,
      present: true,
      length,
      hashType,
      valid,
      detail: valid
        ? `Input ${index} signature verifies against its Taproot output key.`
        : `Input ${index} signature does NOT verify against its Taproot output key.`,
    };
  } catch (error) {
    return {
      index,
      present: true,
      length,
      hashType,
      valid: false,
      detail: `Input ${index} signature could not be checked: ${errorMessage(error)}`,
    };
  }
}

function failedReport(check: VerificationCheck): VerificationReport {
  return {
    ok: false,
    checks: [check],
    txid: null,
    rawTxHex: null,
    inputSats: null,
    outputSats: null,
    feeSats: null,
    weight: null,
    vsize: null,
    inputCount: 0,
    outputCount: 0,
    signedInputCount: 0,
  };
}

/**
 * Verify a wallet-signed PSBT against what the app asked for.
 *
 * Nothing returned by the wallet is trusted: inputs, prevout values, scripts,
 * destination, amount and fee are all re-read from the serialized PSBT, and
 * every signature is checked cryptographically against its sighash.
 */
export function verifySignedPsbt(
  psbtBase64: string,
  expectation: SignedPsbtExpectation,
): VerificationReport {
  const checks: VerificationCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => {
    checks.push({ id, label, ok, detail });
  };

  let tx: btc.Transaction;
  let decoded: DecodedPsbt;
  try {
    tx = parsePsbt(psbtBase64);
    decoded = decodeTransaction(tx, expectation.network);
  } catch (error) {
    return failedReport({
      id: 'psbt-decodable',
      label: 'Signed PSBT decodes',
      ok: false,
      detail: errorMessage(error),
    });
  }

  add('psbt-decodable', 'Signed PSBT decodes', true, `${decoded.inputCount} inputs, ${decoded.outputCount} outputs.`);

  add(
    'input-count',
    'Input count matches the signed request',
    decoded.inputCount === expectation.inputOutpoints.length,
    `expected ${expectation.inputOutpoints.length}, PSBT has ${decoded.inputCount}`,
  );

  const decodedOutpoints = decoded.inputs.map((input) => input.outpoint);
  add(
    'input-outpoints',
    'Exactly the expected outpoints, nothing extra',
    sameOutpointSet(decodedOutpoints, expectation.inputOutpoints),
    sameOutpointSet(decodedOutpoints, expectation.inputOutpoints)
      ? 'all expected outpoints present, no unexpected inputs'
      : `PSBT inputs: ${decodedOutpoints.join(', ')}`,
  );

  const foreignInputs = decoded.inputs.filter(
    (input) => input.scriptHex !== expectation.inputScriptHex,
  );
  add(
    'input-scripts',
    'Every input is the connected Ordinals P2TR output',
    foreignInputs.length === 0,
    foreignInputs.length === 0
      ? `all ${decoded.inputCount} inputs pay the Ordinals address`
      : `inputs ${foreignInputs.map((input) => input.index).join(', ')} pay a different script`, 
  );

  const valueMismatches = decoded.inputs.filter(
    (input) => expectation.inputValues.get(input.outpoint) !== input.amount,
  );
  add(
    'input-values',
    'Prevout values match the scanned UTXO set',
    valueMismatches.length === 0,
    valueMismatches.length === 0
      ? `${decoded.inputSats} sats in`
      : `mismatched values on outpoints: ${valueMismatches.map((input) => input.outpoint).join(', ')}`,
  );

  add(
    'output-count',
    'Exactly one output',
    decoded.outputCount === 1,
    `PSBT has ${decoded.outputCount} output(s)`,
  );

  const destinationOutput = decoded.outputs[0];
  add(
    'output-destination',
    'Destination script is unchanged',
    decoded.outputCount === 1 && destinationOutput.scriptHex === expectation.outputScriptHex,
    decoded.outputCount === 1
      ? `pays ${destinationOutput.address ?? destinationOutput.scriptHex}`
      : 'cannot compare destination with a non-single output',
  );

  add(
    'output-amount',
    'Output amount matches the signed request',
    decoded.outputCount === 1 && destinationOutput.amount === expectation.outputSats,
    decoded.outputCount === 1
      ? `expected ${expectation.outputSats} sats, PSBT has ${destinationOutput.amount} sats`
      : 'no single output to compare',
  );

  add(
    'fee',
    'Mining fee matches the signed request',
    decoded.feeSats === expectation.feeSats,
    `expected ${expectation.feeSats} sats, PSBT implies ${decoded.feeSats} sats`,
  );

  add(
    'conservation',
    'Sats are conserved: inputs = outputs + fee',
    decoded.inputSats === decoded.outputSats + decoded.feeSats && decoded.feeSats > 0n,
    `${decoded.inputSats} in = ${decoded.outputSats} out + ${decoded.feeSats} fee`,
  );

  add(
    'txid-stable',
    'Wallet did not change the transaction being signed',
    decoded.unsignedTxid === expectation.unsignedTxid,
    `expected ${expectation.unsignedTxid}, signed PSBT is ${decoded.unsignedTxid}`,
  );

  const sighashInputs: SighashInput[] = decoded.inputs.map((input) => ({
    txid: input.txid,
    vout: input.vout,
    amount: input.amount,
    script: hex.decode(input.scriptHex),
    sequence: input.sequence,
  }));
  const sighashOutputs: SighashOutput[] = decoded.outputs.map((output) => ({
    amount: output.amount,
    script: hex.decode(output.scriptHex),
  }));
  const midstate = computeSighashMidstate(sighashInputs, sighashOutputs);
  const probes = decoded.inputs.map((input) =>
    probeSignature({
      signature: tx.getInput(input.index).tapKeySig,
      index: input.index,
      outputScript: sighashInputs[input.index].script,
      inputs: sighashInputs,
      outputs: sighashOutputs,
      midstate,
      version: decoded.version,
      lockTime: decoded.lockTime,
    }),
  );

  const signedCount = probes.filter((probe) => probe.present).length;
  add(
    'signatures-present',
    'Every input carries a signature',
    signedCount === decoded.inputCount && signedCount > 0,
    `${signedCount} of ${decoded.inputCount} inputs signed`,
  );

  const invalid = probes.filter((probe) => !probe.valid);
  add(
    'signatures-valid',
    'Every signature verifies cryptographically',
    invalid.length === 0,
    invalid.length === 0
      ? `all ${signedCount} signatures verify against their Taproot output keys`
      : invalid.map((probe) => probe.detail).join(' '),
  );

  const scriptPathInputs = decoded.inputs.filter(
    (input) => (tx.getInput(input.index).tapScriptSig ?? []).length > 0,
  );
  add(
    'no-script-path',
    'No unexpected script-path spend was used',
    scriptPathInputs.length === 0,
    scriptPathInputs.length === 0
      ? 'all inputs are key-path spends'
      : `script-path signatures on inputs ${scriptPathInputs.map((input) => input.index).join(', ')}`,
  );

  let weight: number | null = null;
  let vsize: number | null = null;
  let rawTxHex: string | null = null;
  let finalTxid: string | null = null;
  let extractable = false;
  let extractDetail = '';
  if (!checks.every((check) => check.ok)) {
    // Finalize only after every independent check has passed: a transaction that
    // failed verification is never converted into a broadcastable raw artifact.
    extractDetail = 'Skipped: the transaction did not pass the earlier verification checks, so it was not finalized or serialized.';
  } else {
    try {
      // Finalize a fresh parse rather than the object holding the signatures we
      // just checked: finalization consumes `tapKeySig`. Parsing again is cheaper
      // than cloning, and it independently proves the returned bytes are valid.
      const finalized = parsePsbt(psbtBase64);
      for (let index = 0; index < finalized.inputsLength; index += 1) finalized.finalizeIdx(index);
      weight = finalized.weight;
      vsize = finalized.vsize;
      rawTxHex = hex.encode(finalized.extract());
      finalTxid = finalized.id;
      extractable = weight <= MAX_STANDARD_TX_WEIGHT;
      extractDetail = extractable
        ? `finalized transaction is ${vsize} vB (${weight} WU)`
        : `finalized transaction weight ${weight} WU exceeds the ${MAX_STANDARD_TX_WEIGHT} WU standard limit`;
    } catch (error) {
      extractDetail = `Could not finalize the signed PSBT: ${errorMessage(error)}`;
    }
  }
  add('extractable', 'Signed PSBT is complete and finalizable', extractable, extractDetail);

  // Bind the bytes that would actually be broadcast to the txid the user is
  // asked to authorize. Signatures live in the witness, so finalization must not
  // move the txid; if it ever did, the artifact and the review would disagree.
  add(
    'txid-raw-matches',
    'Finalized bytes hash to the reviewed txid',
    finalTxid !== null && finalTxid === decoded.unsignedTxid,
    finalTxid === null
      ? 'no finalized transaction to hash'      : `finalized bytes hash to ${finalTxid}, reviewed txid is ${decoded.unsignedTxid}`,
  );

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    checks,
    txid: finalTxid ?? decoded.unsignedTxid,
    rawTxHex,
    inputSats: decoded.inputSats,
    outputSats: decoded.outputSats,
    feeSats: decoded.feeSats,
    weight,
    vsize,
    inputCount: decoded.inputCount,
    outputCount: decoded.outputCount,
    signedInputCount: signedCount,
  };
}
