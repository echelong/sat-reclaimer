import { ReclaimerError } from './errors';
import {
  DEFAULT_MAX_INPUTS_PER_BATCH,
  HARD_MAX_INPUTS_PER_BATCH,
  MAX_STANDARD_TX_WEIGHT,
  P2TR_OUTPUT_SCRIPT_BYTES,
  estimateSweepWeight,
  vsizeFor,
} from './bitcoin';
import type {
  InscriptionRow,
  QuarantinedInscription,
  ReclaimBatch,
  ReclaimUtxo,
  UtxoAssessment,
} from './types';

export const ASSET_DETECTION_LIMITATIONS: readonly string[] = [
  'Asset detection is not exhaustive.',
  'The Sats Connect inscriptions API cannot detect runes, BRC-20 balances, or rare sats, so none of them can be ruled out for any output.',
  'A UTXO with no inscriptions is never assumed to be "common sats".',
  'The Bitcoin transaction that gets signed is the only authoritative record of what was spent.',
];

/* -------------------------------------------------------------------------- */
/* Outpoints                                                                  */
/* -------------------------------------------------------------------------- */

const OUTPOINT_RE = /^([0-9a-fA-F]{64}):(\d{1,10})$/;

export function tryParseOutpoint(
  output: string,
): { ok: true; txid: string; vout: number; outpoint: string } | { ok: false; detail: string } {
  if (typeof output !== 'string') return { ok: false, detail: 'outpoint is not a string' };
  const match = OUTPOINT_RE.exec(output.trim());
  if (!match) return { ok: false, detail: `"${output}" is not a txid:vout outpoint` };
  const vout = Number(match[2]);
  if (!Number.isSafeInteger(vout) || vout < 0) {
    return { ok: false, detail: `"${output}" has an out-of-range output index` };
  }
  const txid = match[1].toLowerCase();
  return { ok: true, txid, vout, outpoint: `${txid}:${vout}` };
}

export function parseOutpoint(output: string): { txid: string; vout: number } {
  const parsed = tryParseOutpoint(output);
  if (!parsed.ok) {
    throw new ReclaimerError('INVALID_OUTPOINT', `Invalid Bitcoin outpoint: ${output}`);
  }
  return { txid: parsed.txid, vout: parsed.vout };
}

/* -------------------------------------------------------------------------- */
/* Row validation (indexer data is untrusted)                                 */
/* -------------------------------------------------------------------------- */

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 21e14 sats is Bitcoin's total supply; anything above that is fabricated data. */
const MAX_SATS = 21_000_000n * 100_000_000n;

export function validateInscriptionRow(
  raw: unknown,
): { ok: true; row: InscriptionRow } | { ok: false; detail: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, detail: 'row is not an object' };
  const candidate = raw as Record<string, unknown>;

  const inscriptionId = asString(candidate.inscriptionId);
  const output = asString(candidate.output);
  const postage = asString(candidate.postage) ?? asNumber(candidate.postage)?.toString();

  if (!inscriptionId) return { ok: false, detail: 'row has no inscriptionId' };
  if (!output) return { ok: false, detail: 'row has no output outpoint' };
  if (postage === undefined) return { ok: false, detail: 'row has no postage value' };

  return {
    ok: true,
    row: {
      inscriptionId,
      output,
      postage,
      inscriptionNumber: asString(candidate.inscriptionNumber),
      address: asString(candidate.address),
      contentType: asString(candidate.contentType),
      contentLength: asString(candidate.contentLength),
      timestamp: asNumber(candidate.timestamp),
      genesisTransaction: asString(candidate.genesisTransaction),
      collectionName: asString(candidate.collectionName),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* UTXO set construction                                                      */
/* -------------------------------------------------------------------------- */

export type ScanReduction = {
  utxos: ReclaimUtxo[];
  quarantine: QuarantinedInscription[];
  inscriptionCount: number;
  addressMismatchCount: number;
};

/**
 * Convert inscription rows into a unique UTXO set keyed by `txid:vout`.
 *
 * Multiple inscriptions routinely share one output; that output's postage is
 * counted exactly once. Rows that cannot be trusted (malformed outpoint,
 * invalid postage, an address we cannot sign for, or two rows disagreeing about
 * the value of the same output) are quarantined instead of aborting the scan or
 * being silently dropped.
 */
export function scanInscriptionUtxos(
  rows: unknown[],
  options: { expectedAddress?: string } = {},
): ScanReduction {
  const byOutpoint = new Map<string, ReclaimUtxo>();
  // Providers can repeat rows across pages, so inscription ids are deduplicated
  // per outpoint as well as outpoints being deduplicated overall.
  const seenIds = new Map<string, Set<string>>();
  const quarantine: QuarantinedInscription[] = [];
  let addressMismatchCount = 0;

  for (const raw of rows) {
    const validated = validateInscriptionRow(raw);
    if (!validated.ok) {
      quarantine.push({
        reason: 'malformed-row',
        detail: validated.detail,
        inscriptionId: null,
        output: null,
      });
      continue;
    }
    const row = validated.row;

    if (
      options.expectedAddress &&
      row.address !== undefined &&
      row.address !== options.expectedAddress
    ) {
      addressMismatchCount += 1;
      quarantine.push({
        reason: 'foreign-address',
        detail: `Output belongs to ${row.address}, not the connected Ordinals address.`,
        inscriptionId: row.inscriptionId,
        output: row.output,
      });
      continue;
    }

    const parsed = tryParseOutpoint(row.output);
    if (!parsed.ok) {
      quarantine.push({
        reason: 'malformed-outpoint',
        detail: parsed.detail,
        inscriptionId: row.inscriptionId,
        output: row.output,
      });
      continue;
    }

    let postage: bigint;
    try {
      postage = BigInt(row.postage);
    } catch {
      quarantine.push({
        reason: 'invalid-postage',
        detail: `"${row.postage}" is not an integer sat value.`,
        inscriptionId: row.inscriptionId,
        output: row.output,
      });
      continue;
    }
    if (postage <= 0n || postage > MAX_SATS) {
      quarantine.push({
        reason: 'invalid-postage',
        detail: `${postage} sats is outside the valid range for an output.`,
        inscriptionId: row.inscriptionId,
        output: row.output,
      });
      continue;
    }

    const existing = byOutpoint.get(parsed.outpoint);
    if (existing) {
      if (existing.amount !== postage) {
        // Two rows disagree about the value of the same output. The BIP341
        // signature commits to the prevout amount, so a wrong value produces a
        // transaction the network rejects. Drop the output instead of guessing.
        byOutpoint.delete(parsed.outpoint);
        seenIds.delete(parsed.outpoint);
        quarantine.push({
          reason: 'postage-conflict',
          detail: `Indexer reported ${existing.amount} sats and ${postage} sats for the same output; its true value is unknown, so it is excluded.`,
          inscriptionId: row.inscriptionId,
          output: row.output,
        });
        continue;
      }
      const ids = seenIds.get(parsed.outpoint) ?? new Set(existing.inscriptionIds);
      seenIds.set(parsed.outpoint, ids);
      if (!ids.has(row.inscriptionId)) {
        ids.add(row.inscriptionId);
        existing.inscriptionIds.push(row.inscriptionId);
      }
      existing.contentType ??= row.contentType ?? null;
      existing.collectionName ??= row.collectionName ?? null;
      continue;
    }

    seenIds.set(parsed.outpoint, new Set([row.inscriptionId]));
    byOutpoint.set(parsed.outpoint, {
      txid: parsed.txid,
      vout: parsed.vout,
      outpoint: parsed.outpoint,
      amount: postage,
      inscriptionIds: [row.inscriptionId],
      address: row.address ?? null,
      contentType: row.contentType ?? null,
      collectionName: row.collectionName ?? null,
    });
  }

  const utxos = [...byOutpoint.values()];
  return {
    utxos,
    quarantine,
    inscriptionCount: rows.length,
    addressMismatchCount,
  };
}

/**
 * Strict variant used by tests and trusted callers: throws on the first row that
 * cannot be represented. The app itself uses `scanInscriptionUtxos`.
 */
export function dedupeInscriptionUtxos(rows: InscriptionRow[]): ReclaimUtxo[] {
  const reduction = scanInscriptionUtxos(rows);
  const firstProblem = reduction.quarantine[0];
  if (firstProblem) {
    throw new ReclaimerError(
      firstProblem.reason === 'invalid-postage' ? 'INVALID_POSTAGE' : 'INVALID_OUTPOINT',
      firstProblem.detail,
    );
  }
  return reduction.utxos;
}

export function sumSats(utxos: readonly { amount: bigint }[]): bigint {
  return utxos.reduce((total, utxo) => total + utxo.amount, 0n);
}

export function countInscriptions(utxos: readonly ReclaimUtxo[]): number {
  return utxos.reduce((total, utxo) => total + utxo.inscriptionIds.length, 0);
}

/** Deduplicate a selection by `txid:vout`. */
export function uniqueByOutpoint(utxos: readonly ReclaimUtxo[]): ReclaimUtxo[] {
  const seen = new Map<string, ReclaimUtxo>();
  for (const utxo of utxos) {
    if (!seen.has(utxo.outpoint)) seen.set(utxo.outpoint, utxo);
  }
  return [...seen.values()];
}

/* -------------------------------------------------------------------------- */
/* Batching                                                                   */
/* -------------------------------------------------------------------------- */

export type BatchOptions = {
  maxInputs?: number;
  maxWeight?: number;
  outputScriptBytes?: number;
};

/**
 * Split a UTXO set into sequentially buildable batches, bounded by both an
 * input count (wallet/provider limits are not Bitcoin's limits) and a weight
 * budget (relay policy). Never tries to force a whole wallet into one
 * transaction.
 */
export function splitIntoBatches(
  utxos: readonly ReclaimUtxo[],
  options: BatchOptions = {},
): ReclaimBatch[] {
  const maxInputs = options.maxInputs ?? DEFAULT_MAX_INPUTS_PER_BATCH;
  const maxWeight = options.maxWeight ?? MAX_STANDARD_TX_WEIGHT;
  const outputScriptBytes = options.outputScriptBytes ?? P2TR_OUTPUT_SCRIPT_BYTES;

  if (!Number.isInteger(maxInputs) || maxInputs < 1 || maxInputs > HARD_MAX_INPUTS_PER_BATCH) {
    throw new ReclaimerError(
      'WEIGHT_LIMIT_EXCEEDED',
      `maxInputs must be an integer between 1 and ${HARD_MAX_INPUTS_PER_BATCH}.`,
    );
  }

  const unique = uniqueByOutpoint(utxos);
  const chunks: ReclaimUtxo[][] = [];
  let current: ReclaimUtxo[] = [];

  for (const utxo of unique) {
    const nextLength = current.length + 1;
    const fitsWeight = estimateSweepWeight(nextLength, outputScriptBytes) <= maxWeight;
    const fitsCount = nextLength <= maxInputs;
    if (!fitsCount || !fitsWeight) {
      if (current.length === 0) {
        throw new ReclaimerError(
          'WEIGHT_LIMIT_EXCEEDED',
          'A single input exceeds the transaction weight budget.',
        );
      }
      chunks.push(current);
      current = [utxo];
      continue;
    }
    current.push(utxo);
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((chunk, index) => {
    const weight = estimateSweepWeight(chunk.length, outputScriptBytes);
    return {
      index,
      batchCount: chunks.length,
      utxos: chunk,
      inscriptionCount: countInscriptions(chunk),
      grossSats: sumSats(chunk),
      weight,
      vsize: vsizeFor(weight),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Asset-safety classification                                                */
/* -------------------------------------------------------------------------- */

const JSON_LIKE_CONTENT_TYPES = new Set(['text/plain', 'application/json']);

function isJsonLike(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return JSON_LIKE_CONTENT_TYPES.has(base);
}

/**
 * Classify a UTXO's non-Bitcoin content. Nothing is ever classified as safe:
 * detection through this API is structurally incomplete, and the code says so.
 */
export function assessUtxo(utxo: ReclaimUtxo): UtxoAssessment {
  const warnings: UtxoAssessment['warnings'] = [
    'inscription-bearer',
    'unknown-asset-state',
    'rune-untestable',
    'rare-sat-untestable',
  ];
  const notes: string[] = ['This output carries at least one inscription.'];

  if (utxo.inscriptionIds.length > 1) {
    warnings.push('multi-inscription');
    notes.push(
      `${utxo.inscriptionIds.length} inscriptions share this single output, so spending it affects all of them.`,
    );
  }
  if (!utxo.contentType) {
    warnings.push('unverified-content-type');
    notes.push('The indexer returned no content type, so the payload is unverified.');
  } else if (isJsonLike(utxo.contentType)) {
    warnings.push('brc20-possible');
    notes.push(
      `Content type ${utxo.contentType} is used by JSON-based protocols such as BRC-20, which may hold transferable state here.`,
    );
  }
  if (utxo.collectionName) {
    warnings.push('curated-collection');
    notes.push(`Indexer lists this in the "${utxo.collectionName}" collection.`);
  }
  notes.push('Runes and rare sats cannot be tested for with this API and must be assumed possible.');

  return {
    outpoint: utxo.outpoint,
    inscriptionCount: utxo.inscriptionIds.length,
    warnings,
    detectionComplete: false,
    notes,
  };
}

export function assessUtxos(utxos: readonly ReclaimUtxo[]): UtxoAssessment[] {
  return utxos.map(assessUtxo);
}

export const DESTRUCTIVE_ACKNOWLEDGEMENT =
  'I understand that spending these Bitcoin UTXOs may transfer or permanently affect inscriptions, rare sats, Runes, BRC-20 assets, or other protocols contained in them. I want to treat the sats as ordinary Bitcoin.';

export const ACKNOWLEDGEMENT_PHRASE = 'SPEND AS BTC';

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export type InscriptionsPage = {
  total?: unknown;
  offset?: unknown;
  limit?: unknown;
  inscriptions?: unknown;
};

export type FetchInscriptionsPage = (params: {
  offset: number;
  limit: number;
}) => Promise<InscriptionsPage>;

export type PaginationOptions = {
  limit?: number;
  maxPages?: number;
  maxRows?: number;
};

export type PaginationResult = {
  rows: unknown[];
  pagesFetched: number;
  reportedTotal: number | null;
  truncated: boolean;
  warnings: string[];
};

const MAX_PAGE_LIMIT = 200;

/**
 * Page through `ord_getInscriptions` with hard rails so a broken or hostile
 * provider cannot loop forever, and so a huge wallet is reported honestly
 * instead of silently truncated.
 */
export async function fetchAllInscriptions(
  fetchPage: FetchInscriptionsPage,
  options: PaginationOptions = {},
): Promise<PaginationResult> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), MAX_PAGE_LIMIT);
  const maxPages = options.maxPages ?? 200;
  const maxRows = options.maxRows ?? 20_000;

  const rows: unknown[] = [];
  const warnings: string[] = [];
  let pages = 0;
  let reportedTotal: number | null = null;
  let truncated = false;
  let previousFirstId: string | null = null;
  let offset = 0;

  while (true) {
    if (pages >= maxPages || rows.length >= maxRows) {
      truncated = true;
      warnings.push(
        `Stopped after ${pages} pages / ${rows.length} inscriptions because the scan hit its safety limit. Results are incomplete.`,
      );
      break;
    }

    const page = await fetchPage({ offset, limit });
    if (typeof page !== 'object' || page === null) {
      throw new ReclaimerError(
        'WALLET_MALFORMED_RESPONSE',
        'The wallet returned a malformed inscriptions page.',
      );
    }
    const pageRows = Array.isArray(page.inscriptions) ? page.inscriptions : null;
    if (pageRows === null) {
      throw new ReclaimerError(
        'WALLET_MALFORMED_RESPONSE',
        'The wallet returned an inscriptions page without an inscriptions array.',
      );
    }
    pages += 1;

    const pageTotal = Number(page.total);
    if (Number.isFinite(pageTotal) && pageTotal >= 0) reportedTotal = pageTotal;

    if (pageRows.length === 0) break;

    const firstId = readInscriptionId(pageRows[0]);
    if (firstId !== null && firstId === previousFirstId) {
      warnings.push(
        'The wallet repeated a page instead of advancing the offset; the scan stopped early. Results are incomplete.',
      );
      truncated = true;
      break;
    }
    previousFirstId = firstId;

    rows.push(...pageRows);
    offset += pageRows.length;

    if (reportedTotal !== null && offset >= reportedTotal) break;
    if (pageRows.length < limit) break;
  }

  return { rows, pagesFetched: pages, reportedTotal, truncated, warnings };
}

function readInscriptionId(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null;
  const value = (row as Record<string, unknown>).inscriptionId;
  return typeof value === 'string' ? value : null;
}
