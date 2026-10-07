import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import { ReclaimerError } from './errors';
import type { AppNetwork } from './types';

/**
 * `@scure/btc-signer` only ships two networks: mainnet and "test" (which covers
 * testnet3, testnet4, signet and regtest — they share the `tb` human-readable
 * part and the same base58 testnet prefixes). Signet addresses are therefore
 * valid testnet addresses at the encoding level; this is a property of Bitcoin,
 * not a bug in this app, and it is reported in the UI.
 */
export const SCURE_MAINNET: ScureNetwork = btc.NETWORK;
export const SCURE_TESTNET: ScureNetwork = btc.TEST_NETWORK;
export type ScureNetwork = typeof btc.NETWORK;

export const APP_NETWORKS: readonly AppNetwork[] = ['Signet', 'Testnet', 'Mainnet'];

export function toScureNetwork(network: AppNetwork): ScureNetwork {
  return network === 'Mainnet' ? SCURE_MAINNET : SCURE_TESTNET;
}

/** Consensus/mainnet-relevant limits we enforce locally. */
export const MAX_STANDARD_TX_WEIGHT = 400_000;

/**
 * Measured weight of one P2TR key-path input (outpoint + sequence + 64-byte
 * Schnorr signature in the witness). Asserted against a real signed transaction
 * in `tests/psbt.test.ts`.
 */
export const P2TR_KEYPATH_INPUT_WEIGHT = 230;

/** Script length of a P2TR output, used for the batching weight budget. */
export const P2TR_OUTPUT_SCRIPT_BYTES = 34;

export const DEFAULT_MAX_INPUTS_PER_BATCH = 200;
export const HARD_MAX_INPUTS_PER_BATCH = 500;

/** Fee-rate ceiling so a typo cannot burn an entire wallet. */
export const MAX_FEE_RATE_SAT_VB = 1_000n;

export function isMainnetEnabled(rawFlag: string | undefined): boolean {
  return rawFlag === 'true';
}

export function assertNetworkAllowed(network: AppNetwork, mainnetEnabled: boolean): void {
  if (network === 'Mainnet' && !mainnetEnabled) {
    throw new ReclaimerError(
      'MAINNET_DISABLED',
      'Mainnet is locked in code. It stays disabled until the M1 signer proof passes on Signet/Testnet and mainnet is enabled deliberately.',
    );
  }
}

export function assertFeeRateAllowed(feeRateSatVb: bigint): void {
  if (feeRateSatVb < 1n) {
    throw new ReclaimerError('INVALID_FEE_RATE', 'Fee rate must be at least 1 sat/vB.');
  }
  if (feeRateSatVb > MAX_FEE_RATE_SAT_VB) {
    throw new ReclaimerError(
      'INVALID_FEE_RATE',
      `Fee rate ${feeRateSatVb} sat/vB exceeds the ${MAX_FEE_RATE_SAT_VB} sat/vB safety ceiling.`,
    );
  }
}

function varIntSize(value: number): number {
  if (value < 0xfd) return 1;
  if (value <= 0xffff) return 3;
  if (value <= 0xffffffff) return 5;
  return 9;
}

/**
 * Weight of a single-output sweep spending `inputCount` P2TR key-path inputs and
 * paying to one output of `outputScriptBytes` bytes. Decomposed exactly as
 * BIP141 counting works: 4x the non-witness bytes plus the witness bytes.
 */
export function estimateSweepWeight(
  inputCount: number,
  outputScriptBytes = P2TR_OUTPUT_SCRIPT_BYTES,
): number {
  if (inputCount < 1) throw new ReclaimerError('EMPTY_BATCH', 'Cannot estimate a zero-input sweep.');
  const header = 4 * (4 + 4 + varIntSize(inputCount) + varIntSize(1));
  const marker = 2;
  const inputs = inputCount * P2TR_KEYPATH_INPUT_WEIGHT;
  const outputs = 4 * (8 + varIntSize(outputScriptBytes) + outputScriptBytes);
  return header + marker + inputs + outputs;
}

export function vsizeFor(weight: number): number {
  return Math.ceil(weight / 4);
}

export function feeForWeight(weight: number, feeRateSatVb: bigint): bigint {
  return BigInt(vsizeFor(weight)) * feeRateSatVb;
}

export type ValidatedDestination = {
  address: string;
  script: Uint8Array;
  scriptHex: string;
  scriptType: string;
};

function tryDecodeAddress(address: string, network: AppNetwork) {
  try {
    return btc.Address(toScureNetwork(network)).decode(address);
  } catch {
    return null;
  }
}

/**
 * Validate a destination address for the selected network. Never converts or
 * rewrites an address: a wrong-network or malformed address is rejected.
 */
export function validateDestinationAddress(
  address: string,
  network: AppNetwork,
): ValidatedDestination {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new ReclaimerError('INVALID_DESTINATION', 'Enter a destination Bitcoin address.');
  }
  if (/\s/.test(trimmed)) {
    throw new ReclaimerError(
      'INVALID_DESTINATION',
      'Destination contains whitespace. Paste the address exactly as the wallet showed it.',
    );
  }

  const decoded = tryDecodeAddress(trimmed, network);
  if (!decoded) {
    const otherNetwork: AppNetwork = network === 'Mainnet' ? 'Testnet' : 'Mainnet';
    if (tryDecodeAddress(trimmed, otherNetwork)) {
      throw new ReclaimerError(
        'INVALID_DESTINATION',
        `That is a ${otherNetwork} address, but this transaction is built for ${network}. Addresses are never converted automatically.`,
      );
    }
    throw new ReclaimerError(
      'INVALID_DESTINATION',
      `Not a valid ${network} Bitcoin address (bad checksum, encoding, or network prefix).`,
    );
  }

  const script = btc.OutScript.encode(decoded);
  return {
    address: trimmed,
    script,
    scriptHex: hex.encode(script),
    scriptType: decoded.type,
  };
}

export type OrdinalTaproot = {
  internalPubKey: Uint8Array;
  tweakedPubKey: Uint8Array;
  script: Uint8Array;
  scriptHex: string;
  address: string;
};

/**
 * Normalize the public key Xverse returns for the Ordinals P2TR address.
 * Xverse returns an x-only key; some wallets return a 33-byte compressed key.
 */
export function normalizeOrdinalPublicKey(publicKeyHex: string): Uint8Array {
  const cleaned = publicKeyHex.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(cleaned)) {
    throw new ReclaimerError(
      'ORDINALS_KEY_INVALID',
      'The wallet returned a public key that is not hexadecimal.',
    );
  }
  if (cleaned.length === 64) return hex.decode(cleaned);
  if (cleaned.length === 66) {
    const bytes = hex.decode(cleaned);
    if (bytes[0] !== 0x02 && bytes[0] !== 0x03) {
      throw new ReclaimerError(
        'ORDINALS_KEY_INVALID',
        'The wallet returned a 33-byte public key without a compressed-key prefix byte.',
      );
    }
    return bytes.slice(1);
  }
  throw new ReclaimerError(
    'ORDINALS_KEY_INVALID',
    `Expected a 32-byte x-only Taproot public key from Xverse, received ${cleaned.length / 2} bytes.`,
  );
}

/**
 * Derive the P2TR (BIP86 key-path) output the Ordinals address must be, and
 * refuse to continue if the wallet's address does not match its own public key.
 *
 * This is the gate that stops the app from ever building a PSBT whose inputs
 * are not actually the outputs Xverse can sign for.
 */
export function deriveOrdinalTaproot(args: {
  publicKeyHex: string;
  ordinalsAddress: string;
  network: AppNetwork;
}): OrdinalTaproot {
  const { ordinalsAddress, network } = args;
  const trimmedAddress = ordinalsAddress.trim();
  if (!trimmedAddress) {
    throw new ReclaimerError('ORDINALS_ADDRESS_MISSING', 'Xverse did not return an Ordinals address.');
  }

  const internalPubKey = normalizeOrdinalPublicKey(args.publicKeyHex);
  const payment = btc.p2tr(internalPubKey, undefined, toScureNetwork(network));
  if (!payment.address) {
    throw new ReclaimerError(
      'ORDINALS_KEY_MISMATCH',
      'Could not derive a Taproot address from the public key Xverse returned.',
    );
  }

  const decoded = tryDecodeAddress(trimmedAddress, network);
  if (!decoded) {
    throw new ReclaimerError(
      'ORDINALS_ADDRESS_MISSING',
      `The Ordinals address ${trimmedAddress} is not a valid ${network} address.`,
    );
  }
  if (decoded.type !== 'tr') {
    throw new ReclaimerError(
      'ORDINALS_ADDRESS_MISSING',
      `The Ordinals address is a ${decoded.type} output, not Taproot (P2TR). Inscription UTXOs require a Taproot Ordinals address.`,
    );
  }

  const scriptHex = hex.encode(payment.script);
  const addressMatches = trimmedAddress === payment.address;
  const keyMatches = hex.encode(decoded.pubkey) === hex.encode(payment.tweakedPubkey);
  if (!addressMatches || !keyMatches) {
    throw new ReclaimerError(
      'ORDINALS_KEY_MISMATCH',
      'Refusing to build: the Ordinals address reported by Xverse is not the BIP86 Taproot output derived from the public key it reported. The wallet may have changed addresses, or the address may be a non-BIP86 inscription address that this app cannot safely spend.',
    );
  }

  return {
    internalPubKey,
    tweakedPubKey: payment.tweakedPubkey,
    script: payment.script,
    scriptHex,
    address: payment.address,
  };
}
