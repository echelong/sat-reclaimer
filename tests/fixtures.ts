import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import type { InscriptionRow, ReclaimUtxo } from '../src/lib/types';

/** Deterministic keys. No network access, no randomness. */
export const KEY_A_PRIV = '1'.padStart(64, '0');
export const KEY_B_PRIV = '9'.padStart(64, '0');

export type TaprootFixture = {
  priv: Uint8Array;
  pub: Uint8Array;
  internalPubKeyHex: string;
  address: string;
  script: Uint8Array;
  scriptHex: string;
};

export function taprootFor(privHex: string, network = btc.TEST_NETWORK): TaprootFixture {
  const priv = hex.decode(privHex);
  const pub = btc.utils.pubSchnorr(priv);
  const payment = btc.p2tr(pub, undefined, network);
  if (!payment.address) throw new Error('fixture: p2tr produced no address');
  return {
    priv,
    pub,
    internalPubKeyHex: hex.encode(pub),
    address: payment.address,
    script: payment.script,
    scriptHex: hex.encode(payment.script),
  };
}

export const ORDINALS = taprootFor(KEY_A_PRIV);
export const OTHER_ADDRESS = taprootFor(KEY_B_PRIV).address;

export function txidFor(seed: number): string {
  return seed.toString(16).padStart(64, '0');
}

export function makeUtxo(
  seed: number,
  options: {
    vout?: number;
    amount?: bigint;
    inscriptionIds?: string[];
    address?: string | null;
    contentType?: string | null;
    collectionName?: string | null;
  } = {},
): ReclaimUtxo {
  const txid = txidFor(seed);
  const vout = options.vout ?? 0;
  return {
    txid,
    vout,
    outpoint: `${txid}:${vout}`,
    amount: options.amount ?? 10_000n,
    inscriptionIds: options.inscriptionIds ?? [`inscription-${seed}`],
    address: options.address === undefined ? ORDINALS.address : options.address,
    contentType: options.contentType === undefined ? 'image/png' : options.contentType,
    collectionName: options.collectionName ?? null,
  };
}

export function makeUtxos(count: number, amount = 10_000n): ReclaimUtxo[] {
  return Array.from({ length: count }, (_, index) => makeUtxo(index + 1, { amount }));
}

export function inscriptionRow(
  utxo: ReclaimUtxo,
  index: number,
  overrides: Partial<InscriptionRow> = {},
): InscriptionRow {
  return {
    inscriptionId: `${utxo.txid}i${index}`,
    inscriptionNumber: String(index),
    output: utxo.outpoint,
    postage: utxo.amount.toString(),
    address: utxo.address ?? undefined,
    contentType: utxo.contentType ?? undefined,
    contentLength: '42',
    timestamp: 1_700_000_000,
    genesisTransaction: utxo.txid,
    ...overrides,
  };
}

/** Build `perUtxo` inscription rows for each UTXO, mimicking the real API. */
export function rowsFor(utxos: ReclaimUtxo[], perUtxo = 1): InscriptionRow[] {
  const rows: InscriptionRow[] = [];
  for (const utxo of utxos) {
    for (let index = 0; index < perUtxo; index += 1) {
      rows.push({
        inscriptionId: `${utxo.txid}i${index}`,
        inscriptionNumber: String(rows.length),
        output: utxo.outpoint,
        postage: utxo.amount.toString(),
        address: utxo.address ?? undefined,
        contentType: utxo.contentType ?? undefined,
        contentLength: '42',
        timestamp: 1_700_000_000,
        genesisTransaction: utxo.txid,
      });
    }
  }
  return rows;
}
