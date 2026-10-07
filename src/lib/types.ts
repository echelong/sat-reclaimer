/**
 * Domain types for the reclaim flow.
 *
 * Anything that arrives from a wallet or an indexer is typed as `unknown` at the
 * boundary and converted into these validated shapes before use. The Bitcoin
 * transaction itself is the source of truth; application state is rebuilt from
 * the serialized PSBT rather than trusted.
 */

export type AppNetwork = 'Mainnet' | 'Testnet' | 'Signet';

/** A wallet address returned by Sats Connect, narrowed to what we consume. */
export type WalletAddress = {
  address: string;
  publicKey: string;
  /** `AddressPurpose` from sats-connect: 'ordinals' | 'payment' | ... */
  purpose: string;
  /** `AddressType` from sats-connect: 'p2tr' | 'p2wpkh' | ... */
  addressType: string;
  walletType?: string;
};

export type ConnectedWallet = {
  walletType?: string;
  /** Network the app asked for. */
  requestedNetwork: AppNetwork;
  /** Network the wallet reported on connect. Must equal `requestedNetwork`. */
  walletNetwork: string;
  ordinals: WalletAddress;
  payment?: WalletAddress;
};

/** A single validated inscription row from `ord_getInscriptions`. */
export type InscriptionRow = {
  inscriptionId: string;
  inscriptionNumber?: string;
  address?: string;
  output: string;
  postage: string;
  contentType?: string;
  contentLength?: string;
  timestamp?: number;
  genesisTransaction?: string;
  collectionName?: string;
};

export type QuarantineReason =
  | 'malformed-row'
  | 'malformed-outpoint'
  | 'invalid-postage'
  | 'foreign-address'
  | 'postage-conflict';

export type QuarantinedInscription = {
  reason: QuarantineReason;
  detail: string;
  inscriptionId: string | null;
  output: string | null;
};

/** One unique Bitcoin UTXO that carries one or more inscriptions. */
export type ReclaimUtxo = {
  txid: string;
  vout: number;
  outpoint: string;
  amount: bigint;
  inscriptionIds: string[];
  /** Address reported by the indexer for this output's inscriptions. */
  address: string | null;
  contentType: string | null;
  collectionName: string | null;
};

export type ScanResult = {
  /** Every inscription row the wallet reported (deduplicated UTXOs aside). */
  inscriptionCount: number;
  /** Unique UTXOs keyed by `txid:vout`. */
  utxos: ReclaimUtxo[];
  quarantine: QuarantinedInscription[];
  /** Sats held by the reclaimable UTXO set, counted once per outpoint. */
  grossSats: bigint;
  pagesFetched: number;
  reportedTotal: number | null;
  truncated: boolean;
};

export type ReclaimBatch = {
  index: number;
  batchCount: number;
  utxos: ReclaimUtxo[];
  inscriptionCount: number;
  grossSats: bigint;
  weight: number;
  vsize: number;
};

/** A built, unsigned batch. Every reported number is re-derived from the PSBT. */
export type BuiltBatch = ReclaimBatch & {
  network: AppNetwork;
  destination: string;
  outputScriptHex: string;
  inputSats: bigint;
  outputSats: bigint;
  feeSats: bigint;
  feeRateSatVb: bigint;
  psbtBase64: string;
  /** Input indexes Xverse is told to sign, in PSBT input order. */
  signInputIndexes: number[];
  /** `txid:vout` per PSBT input, in PSBT input order. */
  inputOutpoints: string[];
  unsignedTxid: string;
};

export type AssetWarningCode =
  | 'inscription-bearer'
  | 'multi-inscription'
  | 'unknown-asset-state'
  | 'brc20-possible'
  | 'rune-untestable'
  | 'rare-sat-untestable'
  | 'curated-collection'
  | 'unverified-content-type';

export type UtxoAssessment = {
  outpoint: string;
  inscriptionCount: number;
  warnings: AssetWarningCode[];
  /**
   * Always `false`: the Sats Connect inscriptions API cannot prove that a UTXO
   * carries no runes, BRC-20 state, or rare sats.
   */
  detectionComplete: false;
  notes: string[];
};

export type VerificationCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type DecodedInput = {
  index: number;
  outpoint: string;
  txid: string;
  vout: number;
  amount: bigint;
  scriptHex: string;
  scriptType: string;
  sequence: number;
  hasWitnessUtxo: boolean;
};

export type DecodedOutput = {
  index: number;
  amount: bigint;
  scriptHex: string;
  address: string | null;
  scriptType: string;
};

export type DecodedPsbt = {
  inputs: DecodedInput[];
  outputs: DecodedOutput[];
  inputSats: bigint;
  outputSats: bigint;
  feeSats: bigint;
  inputCount: number;
  outputCount: number;
  unsignedTxid: string;
  version: number;
  lockTime: number;
  isFinal: boolean;
};

/** What the app expects a signed PSBT to contain, taken from the built batch. */
export type SignedPsbtExpectation = {
  network: AppNetwork;
  destination: string;
  /** Script the destination address must pay to. */
  outputScriptHex: string;
  /** Script every input must be spending (the Ordinals P2TR output). */
  inputScriptHex: string;
  outputSats: bigint;
  feeSats: bigint;
  unsignedTxid: string;
  inputOutpoints: string[];
  /** Per-input `txid:vout` -> sats, so the decoder can verify prevouts. */
  inputValues: Map<string, bigint>;
  /** Indexes Xverse was asked to sign. */
  signInputIndexes: number[];
};

export type VerificationReport = {
  ok: boolean;
  checks: VerificationCheck[];
  txid: string | null;
  rawTxHex: string | null;
  inputSats: bigint | null;
  outputSats: bigint | null;
  feeSats: bigint | null;
  weight: number | null;
  vsize: number | null;
  inputCount: number;
  outputCount: number;
  signedInputCount: number;
};
