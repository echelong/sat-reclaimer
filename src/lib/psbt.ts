import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import {
  MAX_STANDARD_TX_WEIGHT,
  assertFeeRateAllowed,
  deriveOrdinalTaproot,
  estimateSweepWeight,
  toScureNetwork,
  validateDestinationAddress,
  vsizeFor,
} from './bitcoin';
import { ReclaimerError } from './errors';
import { uniqueByOutpoint, countInscriptions, sumSats } from './ordinals';
import { decodePsbt } from './verify';
import type {
  AppNetwork,
  BuiltBatch,
  ReclaimBatch,
  SignedPsbtExpectation,
} from './types';

/**
 * Build a single unsigned sweep PSBT that deliberately treats selected
 * inscription-bearing P2TR outputs as ordinary Bitcoin inputs.
 *
 * The builder never trusts its own arithmetic: after serializing the PSBT it
 * decodes it again and derives every reported number (inputs, output amount,
 * fee, weight, txid) from the serialized artifact. If the library's transaction
 * disagrees with this app's expectation the build fails instead of producing a
 * transaction a user might sign.
 */
export function buildSweepBatch(args: {
  batch: ReclaimBatch;
  ordinals: { publicKeyHex: string; address: string };
  destination: string;
  feeRateSatVb: bigint;
  network: AppNetwork;
}): BuiltBatch {
  const { batch, destination, network } = args;
  assertFeeRateAllowed(args.feeRateSatVb);
  if (batch.utxos.length === 0) {
    throw new ReclaimerError('EMPTY_BATCH', 'Cannot build a batch with no inputs.');
  }

  const utxos = uniqueByOutpoint(batch.utxos);
  if (utxos.length !== batch.utxos.length) {
    throw new ReclaimerError(
      'DUPLICATE_INPUT',
      'The batch contained duplicate txid:vout entries. Inputs must be unique.',
    );
  }

  const taproot = deriveOrdinalTaproot({
    publicKeyHex: args.ordinals.publicKeyHex,
    ordinalsAddress: args.ordinals.address,
    network,
  });
  const destinationInfo = validateDestinationAddress(destination, network);
  const scureNetwork = toScureNetwork(network);

  const inputs = utxos.map((utxo) => ({
    txid: hex.decode(utxo.txid),
    index: utxo.vout,
    witnessUtxo: { script: taproot.script, amount: utxo.amount },
    // Required for a BIP86 key-path spend: without it a wallet cannot recognise
    // the input as its own Taproot output.
    tapInternalKey: taproot.internalPubKey,
  }));

  // `all` consumes every supplied input and sends the remainder, after the
  // library's own exact fee calculation, to the destination. No coin selection
  // happens: the user's explicit selection is the whole point.
  const selected = btc.selectUTXO(utxos.length ? inputs : [], [], 'all', {
    changeAddress: destinationInfo.address,
    feePerByte: args.feeRateSatVb,
    createTx: true,
    network: scureNetwork,
  });

  if (!selected?.tx) {
    throw new ReclaimerError(
      'FEE_EXCEEDS_VALUE',
      'These UTXOs cannot economically fund a sweep at this fee rate.',
    );
  }
  const tx = selected.tx;

  if (tx.outputsLength !== 1) {
    throw new ReclaimerError(
      'FEE_EXCEEDS_VALUE',
      `At ${args.feeRateSatVb} sat/vB the remainder after fees is below the dust/relay threshold, so the whole batch would be burned as miner fee. Lower the fee rate or wait for cheaper blocks.`,
    );
  }

  const builtOutput = tx.getOutput(0);
  const builtAmount = builtOutput.amount ?? 0n;
  if (builtAmount <= 0n) {
    throw new ReclaimerError('FEE_EXCEEDS_VALUE', 'Mining fee would consume the entire batch.');
  }
  if (hex.encode(builtOutput.script ?? new Uint8Array()) !== destinationInfo.scriptHex) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      'The builder produced a different destination script than the validated address. Refusing to continue.',
    );
  }

  const psbtBase64 = base64.encode(tx.toPSBT(0));
  const decoded = decodePsbt(psbtBase64, network);

  // ---- Invariants re-derived from the serialized PSBT ----------------------
  if (decoded.inputCount !== utxos.length) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      `PSBT has ${decoded.inputCount} inputs but ${utxos.length} were selected.`,
    );
  }
  const expectedGross = sumSats(utxos);
  if (decoded.inputSats !== expectedGross) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      `PSBT spends ${decoded.inputSats} sats but the selected UTXOs hold ${expectedGross} sats.`,
    );
  }
  if (decoded.outputCount !== 1 || decoded.outputSats !== builtAmount) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      'Decoded output does not match the built transaction.',
    );
  }
  if (decoded.inputSats !== decoded.outputSats + decoded.feeSats) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      `Sats are not conserved: ${decoded.inputSats} in, ${decoded.outputSats} out, ${decoded.feeSats} fee.`,
    );
  }
  if (decoded.outputs[0]?.scriptHex !== destinationInfo.scriptHex) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      'Decoded destination script does not match the address the user entered.',
    );
  }
  const foreignInput = decoded.inputs.find((input) => input.scriptHex !== taproot.scriptHex);
  if (foreignInput) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      `PSBT input ${foreignInput.index} does not pay the connected Ordinals address.`,
    );
  }

  const expectedOutpoints = new Set(utxos.map((utxo) => utxo.outpoint));
  const actualOutpoints = decoded.inputs.map((input) => input.outpoint);
  if (
    actualOutpoints.length !== expectedOutpoints.size ||
    !actualOutpoints.every((outpoint) => expectedOutpoints.has(outpoint)) ||
    new Set(actualOutpoints).size !== actualOutpoints.length
  ) {
    throw new ReclaimerError(
      'INPUT_INDEX_MISMATCH',
      'The PSBT inputs do not match the selected UTXOs one-for-one. Signing indexes cannot be trusted.',
    );
  }

  // Cross-check this app's own weight/fee arithmetic against the library.
  const measuredWeight = estimateSweepWeight(utxos.length, destinationInfo.script.length);
  if (measuredWeight !== selected.weight) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      `Weight estimate mismatch: app computed ${measuredWeight} WU, library computed ${selected.weight} WU.`,
    );
  }
  if (measuredWeight > MAX_STANDARD_TX_WEIGHT) {
    throw new ReclaimerError(
      'WEIGHT_LIMIT_EXCEEDED',
      `Batch weight ${measuredWeight} WU exceeds the ${MAX_STANDARD_TX_WEIGHT} WU standard limit.`,
    );
  }
  if (selected.fee !== decoded.feeSats) {
    throw new ReclaimerError(
      'ACCOUNTING_MISMATCH',
      `Fee mismatch: library reported ${selected.fee} sats, decoded PSBT implies ${decoded.feeSats} sats.`,
    );
  }

  return {
    index: batch.index,
    batchCount: batch.batchCount,
    utxos,
    inscriptionCount: countInscriptions(utxos),
    grossSats: expectedGross,
    weight: measuredWeight,
    vsize: vsizeFor(measuredWeight),
    network,
    destination: destinationInfo.address,
    outputScriptHex: destinationInfo.scriptHex,
    inputSats: decoded.inputSats,
    outputSats: decoded.outputSats,
    feeSats: decoded.feeSats,
    feeRateSatVb: args.feeRateSatVb,
    psbtBase64,
    // Signing indexes are derived from the decoded PSBT, not from the order the
    // UTXOs were handed to the builder.
    signInputIndexes: decoded.inputs.map((input) => input.index),
    inputOutpoints: actualOutpoints,
    unsignedTxid: decoded.unsignedTxid,
  };
}

/** The exact sats-connect `signPsbt` payload for an unsigned batch. */
export function signPsbtRequestFor(batch: BuiltBatch, ordinalsAddress: string) {
  return {
    psbt: batch.psbtBase64,
    signInputs: {
      [ordinalsAddress]: batch.signInputIndexes,
    },
    broadcast: false as const,
  };
}

/** The expectation object the verifier checks a signed PSBT against. */
export function expectationFor(batch: BuiltBatch, inputScriptHex: string): SignedPsbtExpectation {
  return {
    network: batch.network,
    destination: batch.destination,
    outputScriptHex: batch.outputScriptHex,
    inputScriptHex,
    outputSats: batch.outputSats,
    feeSats: batch.feeSats,
    unsignedTxid: batch.unsignedTxid,
    inputOutpoints: batch.inputOutpoints,
    inputValues: new Map(batch.utxos.map((utxo) => [utxo.outpoint, utxo.amount])),
    signInputIndexes: batch.signInputIndexes,
  };
}
