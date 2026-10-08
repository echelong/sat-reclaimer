import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import {
  MAX_STANDARD_TX_WEIGHT,
  MAX_SWEEP_WEIGHT,
  assertFeeRateAllowed,
  assertNetworkAllowed,
  deriveOrdinalTaproot,
  estimateSweepWeight,
  toScureNetwork,
  validateDestinationAddress,
  vsizeFor,
} from './bitcoin';
import { ReclaimerError } from './errors';
import { uniqueByOutpoint, countInscriptions, sumSats } from './ordinals';
import { decodePsbt, parsePsbt } from './verify';
import type {
  AppNetwork,
  BuiltBatch,
  ReclaimBatch,
  ReclaimUtxo,
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
  /** Must be true to build on Mainnet. Defaults to off. */
  mainnetEnabled?: boolean;
}): BuiltBatch {
  const { batch, destination, network } = args;
  assertNetworkAllowed(network, args.mainnetEnabled ?? false);
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

/* -------------------------------------------------------------------------- */
/* Whole-wallet sweep planning                                                */
/* -------------------------------------------------------------------------- */

export type SweepMeasurement = {
  inputCount: number;
  inputSats: bigint;
  outputCount: number;
  outputSats: bigint;
  feeSats: bigint;
  weight: number;
  vsize: number;
  /** Miner fee as a percentage of the sats swept in. */
  feePercent: number;
};

export type SweepPlan = {
  network: AppNetwork;
  destination: string;
  outputScriptHex: string;
  feeRateSatVb: bigint;
  batches: BuiltBatch[];
  measurements: SweepMeasurement[];
  singleTransaction: boolean;
  batchCount: number;
  inputCount: number;
  inputSats: bigint;
  outputSats: bigint;
  feeSats: bigint;
  feePercent: number;
  /** Heaviest single transaction in the plan. */
  maxWeight: number;
  maxVsize: number;
  /** Aggregate weight across every transaction, batching overhead included. */
  totalWeight: number;
};

function feePercentOf(feeSats: bigint, inputSats: bigint): number {
  if (inputSats <= 0n) return 0;
  return Number((feeSats * 10_000n) / inputSats) / 100;
}

/**
 * Measure the exact relay weight the finalized transaction would have, taken
 * from the serialized PSBT.
 *
 * No key material is involved: each unsigned key-path input receives a
 * placeholder signature of exactly the size Xverse returns (a 64-byte BIP340
 * signature for SIGHASH_DEFAULT). Finalized weight depends only on signature
 * size, not on the key or the signature bytes, so this is the real weight the
 * signed transaction will have — not an approximate per-input rule.
 */
export function measureFinalizedWeight(psbtBase64: string): number {
  const tx = parsePsbt(psbtBase64);
  for (let index = 0; index < tx.inputsLength; index += 1) {
    if (!tx.getInput(index).tapKeySig) {
      tx.updateInput(index, { tapKeySig: new Uint8Array(64) }, true);
    }
  }
  for (let index = 0; index < tx.inputsLength; index += 1) tx.finalizeIdx(index);
  return tx.weight;
}

function measurementOf(
  psbtBase64: string,
  network: AppNetwork,
  knownWeight?: number,
): SweepMeasurement {
  const decoded = decodePsbt(psbtBase64, network);
  const weight = knownWeight ?? measureFinalizedWeight(psbtBase64);
  return {
    inputCount: decoded.inputCount,
    inputSats: decoded.inputSats,
    outputCount: decoded.outputCount,
    outputSats: decoded.outputSats,
    feeSats: decoded.feeSats,
    weight,
    vsize: vsizeFor(weight),
    feePercent: feePercentOf(decoded.feeSats, decoded.inputSats),
  };
}

/** Decode a serialized PSBT and report its exact measured size and accounting. */
export function measureSweep(psbtBase64: string, network: AppNetwork): SweepMeasurement {
  return measurementOf(psbtBase64, network);
}

/**
 * Refuse to sweep when the aggregate result is uneconomic. Unlike a per-UTXO
 * rule, this evaluates the whole selected set: 1,083 small UTXOs whose combined
 * value comfortably covers the fee are a valid sweep even though any one of
 * them alone is not.
 */
export function assertSweepEconomic(inputSats: bigint, feeSats: bigint, outputSats: bigint): void {
  if (outputSats <= 0n || inputSats <= feeSats) {
    throw new ReclaimerError(
      'FEE_EXCEEDS_VALUE',
      `The sweep is uneconomic: ${inputSats} sats in, ${feeSats} sats fee, leaving ${outputSats} sats. Lower the fee rate or include more value.`,
    );
  }
}

function batchOf(chunk: ReclaimUtxo[], index: number, batchCount: number): ReclaimBatch {
  return {
    index,
    batchCount,
    utxos: chunk,
    inscriptionCount: countInscriptions(chunk),
    grossSats: sumSats(chunk),
    weight: 0,
    vsize: 0,
  };
}

/**
 * Plan the largest safe sweep of a whole selection.
 *
 * 1. Attempt the entire selection in one transaction and measure its exact
 *    weight from the serialized PSBT.
 * 2. If it fits under the relay policy weight limit (with a safety margin),
 *    that is the plan: one transaction, one destination output.
 * 3. Otherwise compute the largest input count that fits from two real
 *    measurements of this exact transaction shape, and split into the minimum
 *    number of sequential batches.
 *
 * `maxInputsPerBatch` lets the caller force a smaller batch after a wallet
 * rejects a large payload, without touching any transaction validation.
 */
export function planSweep(args: {
  utxos: readonly ReclaimUtxo[];
  ordinals: { publicKeyHex: string; address: string };
  destination: string;
  feeRateSatVb: bigint;
  network: AppNetwork;
  mainnetEnabled?: boolean;
  maxInputsPerBatch?: number;
}): SweepPlan {
  const { network } = args;
  assertNetworkAllowed(network, args.mainnetEnabled ?? false);
  assertFeeRateAllowed(args.feeRateSatVb);

  const utxos = uniqueByOutpoint(args.utxos);
  if (utxos.length === 0) {
    throw new ReclaimerError('EMPTY_BATCH', 'No UTXOs selected to sweep.');
  }

  const destinationInfo = validateDestinationAddress(args.destination, network);
  const build = (chunk: ReclaimUtxo[], index: number, batchCount: number): BuiltBatch =>
    buildSweepBatch({
      batch: batchOf(chunk, index, batchCount),
      ordinals: args.ordinals,
      destination: destinationInfo.address,
      feeRateSatVb: args.feeRateSatVb,
      network,
      mainnetEnabled: args.mainnetEnabled ?? false,
    });

  // 1. Can the entire selection be a single transaction? When the caller has
  // already forced a smaller batch size (wallet fallback), skip the oversized
  // attempt instead of building a transaction that will never be signed.
  const forced = args.maxInputsPerBatch;
  const attemptWhole = forced === undefined || forced >= utxos.length;

  let attempt: BuiltBatch | null = null;
  let attemptWeight: number | null = null;
  let maxPerBatch = utxos.length;

  if (attemptWhole) {
    attempt = build(utxos, 0, 1);
    attemptWeight = measureFinalizedWeight(attempt.psbtBase64);
    if (attemptWeight > MAX_SWEEP_WEIGHT && utxos.length > 1) {
      // For a homogeneous P2TR sweep the finalized weight is affine in the input
      // count: W(n) = intercept + n * slope. Two real measurements pin it exactly.
      const one = build(utxos.slice(0, 1), 0, 1);
      const weightOne = measureFinalizedWeight(one.psbtBase64);
      const slope = (attemptWeight - weightOne) / (utxos.length - 1);
      const intercept = weightOne - slope;
      maxPerBatch =
        slope > 0 ? Math.max(1, Math.floor((MAX_SWEEP_WEIGHT - intercept) / slope)) : utxos.length;
    }
  }
  if (forced !== undefined) {
    maxPerBatch = Math.min(maxPerBatch, Math.max(1, forced));
  }
  maxPerBatch = Math.max(1, Math.min(maxPerBatch, utxos.length));

  // 2. Build the plan, reusing the measured single-transaction build when it fits.
  let batches: BuiltBatch[];
  let knownWeights: (number | undefined)[];
  if (maxPerBatch >= utxos.length && attempt !== null && attemptWeight !== null) {
    batches = [{ ...attempt, index: 0, batchCount: 1 }];
    knownWeights = [attemptWeight];
  } else {
    const chunks: ReclaimUtxo[][] = [];
    for (let index = 0; index < utxos.length; index += maxPerBatch) {
      chunks.push(utxos.slice(index, index + maxPerBatch));
    }
    batches = chunks.map((chunk, index) => build(chunk, index, chunks.length));
    knownWeights = batches.map(() => undefined);
  }

  const measurements = batches.map((built, index) =>
    measurementOf(built.psbtBase64, network, knownWeights[index]),
  );
  for (const [index, measurement] of measurements.entries()) {
    if (measurement.weight > MAX_SWEEP_WEIGHT) {
      throw new ReclaimerError(
        'WEIGHT_LIMIT_EXCEEDED',
        `Sweep batch ${index + 1} measures ${measurement.weight} WU, above the ${MAX_SWEEP_WEIGHT} WU safety budget.`,
      );
    }
  }

  const inputSats = measurements.reduce((total, measurement) => total + measurement.inputSats, 0n);
  const outputSats = measurements.reduce((total, measurement) => total + measurement.outputSats, 0n);
  const feeSats = measurements.reduce((total, measurement) => total + measurement.feeSats, 0n);
  const totalWeight = measurements.reduce((total, measurement) => total + measurement.weight, 0);
  const maxWeight = measurements.reduce((max, measurement) => Math.max(max, measurement.weight), 0);
  const maxVsize = measurements.reduce((max, measurement) => Math.max(max, measurement.vsize), 0);

  assertSweepEconomic(inputSats, feeSats, outputSats);

  return {
    network,
    destination: destinationInfo.address,
    outputScriptHex: destinationInfo.scriptHex,
    feeRateSatVb: args.feeRateSatVb,
    batches,
    measurements,
    singleTransaction: batches.length === 1,
    batchCount: batches.length,
    inputCount: utxos.length,
    inputSats,
    outputSats,
    feeSats,
    feePercent: feePercentOf(feeSats, inputSats),
    maxWeight,
    maxVsize,
    totalWeight,
  };
}
