import { describe, expect, it, vi } from 'vitest';
import {
  ASSET_DETECTION_LIMITATIONS,
  assessUtxo,
  assertScanComplete,
  countInscriptions,
  dedupeInscriptionUtxos,
  fetchAllInscriptions,
  parseOutpoint,
  scanInscriptionUtxos,
  splitIntoBatches,
  sumSats,
  tryParseOutpoint,
  uniqueByOutpoint,
  validateInscriptionRow,
} from '../src/lib/ordinals';
import { HARD_MAX_INPUTS_PER_BATCH, MAX_STANDARD_TX_WEIGHT } from '../src/lib/bitcoin';
import { ReclaimerError } from '../src/lib/errors';
import { ORDINALS, makeUtxo, makeUtxos, rowsFor, txidFor } from './fixtures';

const TXID = txidFor(1);
const TXID2 = txidFor(2);

describe('outpoint parsing', () => {
  it('parses a well-formed outpoint and lowercases the txid', () => {
    expect(parseOutpoint(`${TXID.toUpperCase()}:7`)).toEqual({ txid: TXID, vout: 7 });
    expect(parseOutpoint(` ${TXID}:0 `)).toEqual({ txid: TXID, vout: 0 });
  });

  it.each([
    ['', 'empty'],
    [`${TXID}`, 'no vout'],
    [`${TXID}:`, 'empty vout'],
    [`${TXID}:-1`, 'negative vout'],
    [`${TXID}:1.5`, 'fractional vout'],
    [`${TXID.slice(0, 63)}:0`, 'short txid'],
    [`${TXID}:0:0`, 'extra fields'],
    [`zz${TXID.slice(2)}:0`, 'non-hex txid'],
    [`${TXID}:99999999999999999999`, 'overflowing vout'],
  ])('rejects %s (%s)', (value) => {
    expect(tryParseOutpoint(value).ok).toBe(false);
    expect(() => parseOutpoint(value)).toThrow(ReclaimerError);
  });
});

describe('UTXO set construction', () => {
  it('counts an output with many inscriptions exactly once', () => {
    const rows = [
      { inscriptionId: 'one', output: `${TXID}:0`, postage: '10000' },
      { inscriptionId: 'two', output: `${TXID}:0`, postage: '10000' },
      { inscriptionId: 'three', output: `${TXID}:0`, postage: '10000' },
      { inscriptionId: 'four', output: `${TXID2}:1`, postage: '546' },
    ];

    const result = scanInscriptionUtxos(rows);

    expect(result.utxos).toHaveLength(2);
    expect(countInscriptions(result.utxos)).toBe(4);
    expect(sumSats(result.utxos)).toBe(10_546n);
    expect(result.utxos[0].inscriptionIds).toEqual(['one', 'two', 'three']);
    expect(result.quarantine).toHaveLength(0);
  });

  it('handles zero inscriptions', () => {
    const result = scanInscriptionUtxos([]);
    expect(result.utxos).toHaveLength(0);
    expect(result.inscriptionCount).toBe(0);
    expect(sumSats(result.utxos)).toBe(0n);
  });

  it('handles one inscription', () => {
    const result = scanInscriptionUtxos([{ inscriptionId: 'a', output: `${TXID}:3`, postage: '546' }]);
    expect(result.utxos).toHaveLength(1);
    expect(result.utxos[0]).toMatchObject({ txid: TXID, vout: 3, outpoint: `${TXID}:3`, amount: 546n });
  });

  it('scales to 1,000+ inscriptions across duplicate outpoints', () => {
    const utxos = makeUtxos(500);
    const rows = rowsFor(utxos, 3);
    const result = scanInscriptionUtxos(rows);

    expect(result.inscriptionCount).toBe(1500);
    expect(result.utxos).toHaveLength(500);
    expect(sumSats(result.utxos)).toBe(500n * 10_000n);
  });

  it('deduplicates outpoints repeated across API pages', () => {
    const utxo = makeUtxo(7, { inscriptionIds: ['a', 'b'] });
    const row = { inscriptionId: 'a', output: utxo.outpoint, postage: '10000' };
    const duplicate = { inscriptionId: 'b', output: utxo.outpoint, postage: '10000' };

    const result = scanInscriptionUtxos([row, duplicate, row, duplicate]);

    expect(result.utxos).toHaveLength(1);
    expect(result.utxos[0].inscriptionIds).toEqual(['a', 'b']);
    expect(sumSats(result.utxos)).toBe(10_000n);
  });

  it('quarantines malformed outpoints instead of aborting the whole scan', () => {
    const result = scanInscriptionUtxos([
      { inscriptionId: 'good', output: `${TXID}:0`, postage: '1000' },
      { inscriptionId: 'bad', output: 'not-an-outpoint', postage: '1000' },
      { inscriptionId: 'bad2', output: `${TXID}:oops`, postage: '1000' },
    ]);

    expect(result.utxos).toHaveLength(1);
    expect(result.quarantine.map((entry) => entry.reason)).toEqual([
      'malformed-outpoint',
      'malformed-outpoint',
    ]);
  });

  it('quarantines invalid postage values', () => {
    const result = scanInscriptionUtxos([
      { inscriptionId: 'zero', output: `${TXID}:0`, postage: '0' },
      { inscriptionId: 'negative', output: `${TXID}:1`, postage: '-5' },
      { inscriptionId: 'huge', output: `${TXID}:2`, postage: '999999999999999999999999' },
      { inscriptionId: 'text', output: `${TXID3(3)}:0`, postage: 'about 1000' },
    ]);

    expect(result.utxos).toHaveLength(0);
    expect(result.quarantine.every((entry) => entry.reason === 'invalid-postage')).toBe(true);
  });

  it('quarantines rows that disagree about the value of the same output', () => {
    const result = scanInscriptionUtxos([
      { inscriptionId: 'a', output: `${TXID}:0`, postage: '10000' },
      { inscriptionId: 'b', output: `${TXID}:0`, postage: '546' },
    ]);

    expect(result.utxos).toHaveLength(0);
    expect(result.quarantine.map((entry) => entry.reason)).toContain('postage-conflict');
  });

  it('quarantines outputs belonging to an address we cannot sign for', () => {
    const result = scanInscriptionUtxos(
      [
        { inscriptionId: 'mine', output: `${TXID}:0`, postage: '1000', address: ORDINALS.address },
        { inscriptionId: 'theirs', output: `${TXID2}:0`, postage: '1000', address: 'bc1qsomeoneelse' },
      ],
      { expectedAddress: ORDINALS.address },
    );

    expect(result.utxos).toHaveLength(1);
    expect(result.addressMismatchCount).toBe(1);
    expect(result.quarantine[0].reason).toBe('foreign-address');
  });

  it('quarantines malformed rows (wrong types, missing fields)', () => {
    const result = scanInscriptionUtxos([
      null,
      'a string',
      42,
      {},
      { inscriptionId: 'x' },
      { inscriptionId: 'x', output: `${TXID}:0` },
      { inscriptionId: 5, output: `${TXID}:0`, postage: '1' },
    ]);

    expect(result.utxos).toHaveLength(0);
    expect(result.quarantine.every((entry) => entry.reason === 'malformed-row')).toBe(true);
  });

  it('keeps numeric postage and coerces it to a string', () => {
    const validated = validateInscriptionRow({
      inscriptionId: 'a',
      output: `${TXID}:0`,
      postage: 1000,
    });
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.row.postage).toBe('1000');
  });

  it('keeps the strict helper throwing on untrustworthy rows', () => {
    expect(() => dedupeInscriptionUtxos(rowsFor(makeUtxos(2), 1))).not.toThrow();
    expect(() => dedupeInscriptionUtxos([{ inscriptionId: 'a', output: 'nope', postage: '1' }])).toThrow(
      ReclaimerError,
    );
  });

  it('uniqueByOutpoint keeps the first occurrence', () => {
    const first = makeUtxo(1, { amount: 1000n });
    const second = makeUtxo(1, { amount: 9999n });
    expect(uniqueByOutpoint([first, second])).toEqual([first]);
  });
});

describe('pagination', () => {
  function paged(rows: unknown[], total = rows.length, limit = 100) {
    return vi.fn(async ({ offset }: { offset: number; limit: number }) => ({
      total,
      offset,
      limit,
      inscriptions: rows.slice(offset, offset + limit),
    }));
  }

  it('follows every page until the reported total is reached', async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      inscriptionId: `i${index}`,
      output: `${txidFor(index + 1)}:0`,
      postage: '546',
    }));
    const fetchPage = paged(rows, 250, 100);

    const result = await fetchAllInscriptions(fetchPage, { limit: 100 });

    expect(result.rows).toHaveLength(250);
    expect(result.pagesFetched).toBe(3);
    expect(result.reportedTotal).toBe(250);
    expect(result.truncated).toBe(false);
  });

  it('does NOT stop on a short page when the indexer reported more', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ inscriptionId: `i${index}` }));
    const fetchPage = paged(rows, 1000, 100);

    const result = await fetchAllInscriptions(fetchPage, { limit: 100 });

    expect(result.rows).toHaveLength(30);
    // Page 1 plus the explicit empty page that signals the end of the data.
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.complete).toBe(false);
  });

  it('retrieves a full 1,083-inscription wallet across 60-row capped pages', async () => {
    const rows = Array.from({ length: 1083 }, (_, index) => ({
      inscriptionId: `insc-${index}`,
      output: `${txidFor(index + 1)}:0`,
      postage: '546',
    }));
    // Xverse returns a capped 60-row page even when asked for 100.
    const fetchPage = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
      total: 1083,
      offset,
      limit,
      inscriptions: rows.slice(offset, offset + 60),
    }));

    const result = await fetchAllInscriptions(fetchPage, { limit: 100 });

    expect(result.retrievedCount).toBe(1083);
    expect(result.reportedTotal).toBe(1083);
    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.pagesFetched).toBe(19);
  });

  it('deduplicates repeated inscription ids globally across pages', async () => {
    const fetchPage = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
      total: 4,
      offset,
      limit,
      inscriptions:
        offset === 0
          ? [{ inscriptionId: 'a' }, { inscriptionId: 'b' }, { inscriptionId: 'c' }]
          : [{ inscriptionId: 'b' }, { inscriptionId: 'c' }, { inscriptionId: 'd' }],
    }));

    const result = await fetchAllInscriptions(fetchPage, { limit: 3 });

    expect(result.retrievedCount).toBe(4);
    expect(result.duplicateIdCount).toBe(2);
    expect(result.complete).toBe(true);
  });

  it('stops a provider that repeats a page instead of advancing', async () => {
    const page = [{ inscriptionId: 'same', output: `${TXID}:0`, postage: '546' }];
    const fetchPage = vi.fn(async () => ({ total: 10_000, inscriptions: page }));

    const result = await fetchAllInscriptions(fetchPage, { limit: 1 });

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/repeated a page/);
  });

  it('enforces the page-count safety limit and says the result is incomplete', async () => {
    const fetchPage = vi.fn(async ({ offset }: { offset: number; limit: number }) => ({
      total: 1_000_000,
      inscriptions: Array.from({ length: 10 }, (_, index) => ({
        inscriptionId: `p${offset}-${index}`,
      })),
    }));

    const result = await fetchAllInscriptions(fetchPage, { limit: 10, maxPages: 3 });

    expect(result.pagesFetched).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/safety limit/);
  });

  it('rejects a malformed page', async () => {
    await expect(
      fetchAllInscriptions(async () => ({ total: 1 }) as never),
    ).rejects.toMatchObject({ code: 'WALLET_MALFORMED_RESPONSE' });
    await expect(
      fetchAllInscriptions(async () => null as never),
    ).rejects.toMatchObject({ code: 'WALLET_MALFORMED_RESPONSE' });
  });

  it('treats a null total as unknown and reads through the explicit empty page', async () => {
    const fetchPage = vi.fn(async ({ offset }: { offset: number; limit: number }) => ({
      total: null, inscriptions: offset < 2 ? [{ inscriptionId: `i${offset}` }] : [],
    }));
    const result = await fetchAllInscriptions(fetchPage);
    expect(result.pagesFetched).toBe(3);
    expect(result.retrievedCount).toBe(2);
    expect(result.reportedTotal).toBeNull();
    expect(result.complete).toBe(true);
  });

  it.each(['', 'wrong', -1, 1.5, Infinity, true])('refuses a malformed inscription total %s', async (total) => {
    await expect(fetchAllInscriptions(async () => ({ total, inscriptions: [{ inscriptionId: 'one' }] })))
      .rejects.toMatchObject({ code: 'WALLET_MALFORMED_RESPONSE' });
  });

  it('does not call a shrinking inventory complete after a wallet changes mid-scan', async () => {
    const result = await fetchAllInscriptions(async ({ offset }) => ({
      total: offset === 0 ? 3 : 1, inscriptions: [{ inscriptionId: `i${offset}` }],
    }));
    expect(result.complete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(' ')).toContain('changed');
  });

  it('blocks an inconsistent zero total with nonempty rows', async () => {
    const result = await fetchAllInscriptions(async () => ({ total: 0, inscriptions: [{ inscriptionId: 'one' }] }));
    expect(result.complete).toBe(false);
  });

  it('clamps an oversized page limit', async () => {
    const fetchPage = vi.fn(async ({ limit }: { offset: number; limit: number }) => ({
      total: 0,
      inscriptions: [],
      limit,
    }));
    await fetchAllInscriptions(fetchPage, { limit: 100_000 });
    expect(fetchPage.mock.calls[0][0].limit).toBe(200);
  });

  it('reduces every fetched page to one UTXO per outpoint (the Select All set)', async () => {
    // 120 outputs, two inscriptions each, served across capped pages.
    const utxos = makeUtxos(120, 10_000n);
    const rows = rowsFor(utxos, 2);
    const fetchPage = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
      total: rows.length,
      offset,
      limit,
      inscriptions: rows.slice(offset, offset + 60),
    }));

    const page = await fetchAllInscriptions(fetchPage, { limit: 100 });
    const reduction = scanInscriptionUtxos(page.rows);

    expect(page.retrievedCount).toBe(240);
    expect(page.complete).toBe(true);
    expect(reduction.utxos).toHaveLength(120);
    expect(new Set(reduction.utxos.map((utxo) => utxo.outpoint)).size).toBe(120);
    // Two inscriptions share each output, but its sats are counted exactly once.
    expect(countInscriptions(reduction.utxos)).toBe(240);
    expect(sumSats(reduction.utxos)).toBe(120n * 10_000n);
  });
});

describe('scan completeness gate', () => {
  it('refuses Sweep All on an incomplete or truncated scan', () => {
    expect(() =>
      assertScanComplete({ complete: false, reportedTotal: 1083, retrievedCount: 60 }),
    ).toThrow(expect.objectContaining({ code: 'SCAN_INCOMPLETE' }));
    expect(() =>
      assertScanComplete({ complete: false, reportedTotal: null, retrievedCount: 60 }),
    ).toThrow(expect.objectContaining({ code: 'SCAN_INCOMPLETE' }));
    expect(() =>
      assertScanComplete({ complete: true, reportedTotal: 1083, retrievedCount: 1083 }),
    ).not.toThrow();
  });
});

describe('batching', () => {
  it('splits a 1,000 UTXO wallet into weight-safe batches', () => {
    const batches = splitIntoBatches(makeUtxos(1_000), { maxInputs: 200 });

    expect(batches.map((batch) => batch.utxos.length)).toEqual([200, 200, 200, 200, 200]);
    expect(batches.map((batch) => batch.batchCount)).toEqual([5, 5, 5, 5, 5]);
    expect(batches.map((batch) => batch.index)).toEqual([0, 1, 2, 3, 4]);
    expect(batches.every((batch) => batch.weight <= MAX_STANDARD_TX_WEIGHT)).toBe(true);
    expect(sumSats(batches.flatMap((batch) => batch.utxos))).toBe(1_000n * 10_000n);
  });

  it('splits a 901 UTXO wallet deterministically', () => {
    const batches = splitIntoBatches(makeUtxos(901), { maxInputs: 200 });
    expect(batches.map((batch) => batch.utxos.length)).toEqual([200, 200, 200, 200, 101]);
  });

  it('is stable and complete: every UTXO appears exactly once', () => {
    const utxos = makeUtxos(457);
    const batches = splitIntoBatches(utxos, { maxInputs: 50 });
    const seen = batches.flatMap((batch) => batch.utxos.map((utxo) => utxo.outpoint));

    expect(new Set(seen).size).toBe(457);
    expect(seen).toEqual(utxos.map((utxo) => utxo.outpoint));
  });

  it('respects the weight budget when the input cap is very high', () => {
    const batches = splitIntoBatches(makeUtxos(3_000), { maxInputs: HARD_MAX_INPUTS_PER_BATCH });
    expect(batches.every((batch) => batch.weight <= MAX_STANDARD_TX_WEIGHT)).toBe(true);
    expect(batches.every((batch) => batch.utxos.length <= HARD_MAX_INPUTS_PER_BATCH)).toBe(true);
    expect(batches.flatMap((batch) => batch.utxos)).toHaveLength(3_000);
  });

  it('rejects nonsense input caps', () => {
    expect(() => splitIntoBatches(makeUtxos(1), { maxInputs: 0 })).toThrow(ReclaimerError);
    expect(() => splitIntoBatches(makeUtxos(1), { maxInputs: HARD_MAX_INPUTS_PER_BATCH + 1 })).toThrow(
      ReclaimerError,
    );
    expect(() => splitIntoBatches(makeUtxos(1), { maxInputs: 1.5 })).toThrow(ReclaimerError);
  });

  it('counts inscriptions per batch', () => {
    const batches = splitIntoBatches(makeUtxos(10), { maxInputs: 4 });
    expect(batches.map((batch) => batch.inscriptionCount)).toEqual([4, 4, 2]);
  });
});

describe('asset-safety classification', () => {
  it('never claims a UTXO is safe', () => {
    const assessment = assessUtxo(makeUtxo(1));

    expect(assessment.detectionComplete).toBe(false);
    expect(assessment.warnings).toContain('inscription-bearer');
    expect(assessment.warnings).toContain('unknown-asset-state');
    expect(assessment.warnings).toContain('rune-untestable');
    expect(assessment.warnings).toContain('rare-sat-untestable');
    expect(assessment.warnings).not.toContain('common-sats');
  });

  it('flags multiple inscriptions sharing one output', () => {
    const assessment = assessUtxo(makeUtxo(1, { inscriptionIds: ['a', 'b', 'c'] }));
    expect(assessment.inscriptionCount).toBe(3);
    expect(assessment.warnings).toContain('multi-inscription');
    expect(assessment.notes.join(' ')).toMatch(/3 inscriptions share this single output/);
  });

  it('flags JSON-like content types as a BRC-20 risk', () => {
    expect(assessUtxo(makeUtxo(1, { contentType: 'text/plain;charset=utf-8' })).warnings).toContain(
      'brc20-possible',
    );
    expect(assessUtxo(makeUtxo(2, { contentType: 'application/json' })).warnings).toContain(
      'brc20-possible',
    );
    expect(assessUtxo(makeUtxo(3, { contentType: 'image/png' })).warnings).not.toContain(
      'brc20-possible',
    );
  });

  it('flags missing content types as unverified', () => {
    expect(assessUtxo(makeUtxo(1, { contentType: null })).warnings).toContain(
      'unverified-content-type',
    );
  });

  it('flags curated collections', () => {
    const assessment = assessUtxo(makeUtxo(1, { collectionName: 'NodeMonkes' }));
    expect(assessment.warnings).toContain('curated-collection');
    expect(assessment.notes.join(' ')).toMatch(/NodeMonkes/);
  });

  it('documents its own limitations', () => {
    expect(ASSET_DETECTION_LIMITATIONS).toContain('Asset detection is not exhaustive.');
  });
});

function TXID3(seed: number): string {
  return txidFor(seed);
}
