import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import {
  dustThresholdSats,
  estimateSweepWeight,
  feeForWeight,
  vsizeFor,
} from '../src/lib/bitcoin';
import { errorCode } from '../src/lib/errors';
import { scanInscriptionUtxos, splitIntoBatches } from '../src/lib/ordinals';
import { buildSweepBatch, expectationFor, planSweep } from '../src/lib/psbt';
import { verifySignedPsbt } from '../src/lib/verify';
import {
  assertFinalizedTransaction,
  checkTxidStatus,
  txidFromRawTransaction,
  type BroadcastFetch,
  type BroadcastResponse,
} from '../src/lib/broadcast';
import type { BuiltBatch } from '../src/lib/types';
import {
  KEY_B_PRIV,
  ORDINALS,
  inscriptionRow,
  makeUtxo,
  makeUtxos,
  taprootFor,
} from './fixtures';

/**
 * Regression tests for the issues found in the M4 security review of the
 * transaction lifecycle. Each block names the finding it locks down, so a future
 * refactor that reopens one of them fails here rather than in the field.
 */

const OTHER = taprootFor(KEY_B_PRIV);

function build(count: number, feeRateSatVb = 2n): BuiltBatch {
  const [batch] = splitIntoBatches(makeUtxos(count), { maxInputs: 500 });
  return buildSweepBatch({
    batch,
    ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
    destination: OTHER.address,
    feeRateSatVb,
    network: 'Signet',
  });
}

function signBatch(batch: BuiltBatch): string {
  const tx = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));
  for (let index = 0; index < tx.inputsLength; index += 1) {
    tx.signIdx(ORDINALS.priv, index);
  }
  return base64.encode(tx.toPSBT(0));
}

function checkById(report: ReturnType<typeof verifySignedPsbt>, id: string) {
  return report.checks.find((check) => check.id === id);
}

/* -------------------------------------------------------------------------- */
/* F1 — a postage conflict must exclude an outpoint for the whole scan         */
/* -------------------------------------------------------------------------- */

describe('F1: postage conflict cannot be undone by a later row', () => {
  it('keeps the outpoint excluded when the original value is reported again', () => {
    const utxo = makeUtxo(1, { amount: 546n });
    const rows = [
      inscriptionRow(utxo, 0),
      inscriptionRow(utxo, 1, { postage: '1000' }),
      inscriptionRow(utxo, 2),
    ];

    const result = scanInscriptionUtxos(rows, { expectedAddress: ORDINALS.address });

    // Before the fix the third row re-created the output with the original
    // value, silently re-admitting an output whose true value is unknown.
    expect(result.utxos).toHaveLength(0);
    expect(result.quarantine.filter((entry) => entry.reason === 'postage-conflict')).toHaveLength(2);
  });

  it('still accepts a repeated row that agrees with itself', () => {
    const utxo = makeUtxo(2, { amount: 546n });
    const result = scanInscriptionUtxos([inscriptionRow(utxo, 0), inscriptionRow(utxo, 1)], {
      expectedAddress: ORDINALS.address,
    });
    expect(result.utxos).toHaveLength(1);
    expect(result.utxos[0].inscriptionIds).toHaveLength(2);
    expect(result.quarantine).toHaveLength(0);
  });

  it('matches the connected address case-insensitively, because bech32 is case-insensitive', () => {
    const utxo = makeUtxo(3);
    const upper = ORDINALS.address.toUpperCase();
    const result = scanInscriptionUtxos([inscriptionRow(utxo, 0, { address: upper })], {
      expectedAddress: ORDINALS.address,
    });
    // Same address, different case: this is the user's own UTXO, not a foreign one.
    expect(result.utxos).toHaveLength(1);
    expect(result.addressMismatchCount).toBe(0);
  });

  it('reports rows that arrived with no address at all', () => {
    const utxo = makeUtxo(4);
    const result = scanInscriptionUtxos([inscriptionRow(utxo, 0, { address: undefined })], {
      expectedAddress: ORDINALS.address,
    });
    expect(result.utxos).toHaveLength(1);
    expect(result.unverifiedAddressCount).toBe(1);
    expect(result.addressMismatchCount).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* F2 — the verifier must compare outpoint sets in both directions             */
/* -------------------------------------------------------------------------- */

describe('F2: outpoint comparison is set equality, not one-way membership', () => {
  it('rejects a PSBT that duplicates one input and drops another', () => {
    const batch = build(2);
    const expectation = expectationFor(batch, ORDINALS.scriptHex);

    const tx = btc.Transaction.fromPSBT(base64.decode(batch.psbtBase64));
    // Emulate a wallet returning input 0 twice: same length, and every decoded
    // outpoint is still one of the expected ones.
    tx.updateInput(1, { txid: tx.getInput(0).txid, index: tx.getInput(0).index });
    const doctored = base64.encode(tx.toPSBT(0));

    const report = verifySignedPsbt(doctored, expectation);
    expect(checkById(report, 'input-outpoints')?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('still accepts the untouched signed transaction', () => {
    const batch = build(2);
    const report = verifySignedPsbt(signBatch(batch), expectationFor(batch, ORDINALS.scriptHex));
    expect(checkById(report, 'input-outpoints')?.ok).toBe(true);
    expect(report.ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* F3 — dust threshold, reproduced from Bitcoin Core policy                    */
/* -------------------------------------------------------------------------- */

describe('F3: dust thresholds match Bitcoin Core', () => {
  const p2wpkh = hex.decode(`0014${'00'.repeat(20)}`);
  const p2sh = hex.decode(`a914${'11'.repeat(20)}87`);
  const p2pkh = hex.decode(`76a914${'22'.repeat(20)}88ac`);

  it('computes the witness-discounted threshold for witness programs', () => {
    expect(dustThresholdSats(ORDINALS.script)).toBe(330n); // P2TR
    expect(dustThresholdSats(p2wpkh)).toBe(294n);
  });

  it('computes the full-size threshold for legacy scripts', () => {
    expect(dustThresholdSats(p2sh)).toBe(540n);
    expect(dustThresholdSats(p2pkh)).toBe(546n);
  });

  it('never lets the builder emit a below-threshold destination output', () => {
    // The library collapses a below-dust remainder into the fee, so today this
    // path is unreachable and the existing guard fires first. Assert the guard
    // is still there for the case the library stops doing that.
    expect(() =>
      buildSweepBatch({
        batch: {
          index: 0,
          batchCount: 1,
          utxos: [makeUtxo(9, { amount: 400n })],
          inscriptionCount: 1,
          grossSats: 400n,
          weight: 0,
          vsize: 0,
        },
        ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
        destination: OTHER.address,
        feeRateSatVb: 1n,
        network: 'Signet',
      }),
    ).toThrow(expect.objectContaining({ code: 'FEE_EXCEEDS_VALUE' }));
  });
});

/* -------------------------------------------------------------------------- */
/* F4 — the fee must cover the transaction's own measured size                 */
/* -------------------------------------------------------------------------- */

describe('F4: fee pays for the exact measured size', () => {
  it('pays exactly vsize x fee rate for every measured size', () => {
    for (const count of [1, 2, 17, 200]) {
      for (const rate of [1n, 3n, 40n]) {
        const batch = build(count, rate);
        const required = feeForWeight(batch.weight, rate);
        expect(batch.feeSats).toBe(required);
        expect(batch.vsize).toBe(vsizeFor(batch.weight));
        expect(batch.inputSats).toBe(batch.outputSats + batch.feeSats);
      }
    }
  });

  it('agrees with the independent analytic weight model', () => {
    for (const count of [1, 2, 17, 200]) {
      const batch = build(count);
      expect(batch.weight).toBe(estimateSweepWeight(count, 34));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* F5 — a key-path signature may only be probed against a real P2TR program    */
/* -------------------------------------------------------------------------- */

describe('F5: P2TR witness-program shape is enforced before probing a signature', () => {
  it('refuses a 0x51-prefixed script that is not a 32-byte program', () => {
    const decoy = new Uint8Array(34);
    decoy[0] = 0x51;
    decoy[1] = 0x1f; // pushes 31 bytes, not a valid witness v1 program

    const outpointTxid = hex.decode(makeUtxo(11).txid);
    const tx = new btc.Transaction();
    tx.addInput({ txid: outpointTxid, index: 0, witnessUtxo: { script: decoy, amount: 10_000n } });
    tx.addOutput({ script: OTHER.script, amount: 9_000n });
    tx.updateInput(0, { tapKeySig: new Uint8Array(64).fill(7) });

    const report = verifySignedPsbt(base64.encode(tx.toPSBT(0)), {
      network: 'Signet',
      destination: OTHER.address,
      outputScriptHex: OTHER.scriptHex,
      inputScriptHex: hex.encode(decoy),
      outputSats: 9_000n,
      feeSats: 1_000n,
      unsignedTxid: tx.id,
      inputOutpoints: [`${makeUtxo(11).txid}:0`],
      inputValues: new Map([[`${makeUtxo(11).txid}:0`, 10_000n]]),
      signInputIndexes: [0],
    });

    const signatureCheck = checkById(report, 'signatures-valid');
    expect(signatureCheck?.ok).toBe(false);
    expect(signatureCheck?.detail).toContain('32-byte P2TR witness program');
  });
});

/* -------------------------------------------------------------------------- */
/* F6 — an unparseable status body must not be reported as "in the mempool"    */
/* -------------------------------------------------------------------------- */

function response(status: number, body: string): BroadcastResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

describe('F6: ambiguous txid-status bodies are inconclusive, not a mempool claim', () => {
  const txid = 'ab'.repeat(32);

  it('skips an endpoint that answers 200 without a confirmed flag', async () => {
    const seen: string[] = [];
    const fetchImpl: BroadcastFetch = async (url) => {
      seen.push(url);
      if (seen.length === 1) return response(200, JSON.stringify({ hello: 'world' }));
      return response(200, JSON.stringify({ confirmed: true, block_height: 970_454 }));
    };

    const status = await checkTxidStatus({
      txid,
      network: 'Mainnet',
      fetchImpl,
      endpoints: [
        { label: 'first', apiBase: 'https://one.invalid/api', explorerTxUrl: () => 'https://one.invalid' },
        { label: 'second', apiBase: 'https://two.invalid/api', explorerTxUrl: () => 'https://two.invalid' },
      ],
    });

    expect(seen).toHaveLength(2);
    expect(status.confirmed).toBe(true);
    expect(status.blockHeight).toBe(970_454);
    expect(status.endpoint).toBe('second');
  });

  it('reports a genuine unconfirmed mempool answer', async () => {
    const fetchImpl: BroadcastFetch = async () =>
      response(200, JSON.stringify({ confirmed: false }));
    const status = await checkTxidStatus({ txid, network: 'Mainnet', fetchImpl });
    expect(status.found).toBe(true);
    expect(status.confirmed).toBe(false);
    expect(status.detail).toContain('mempool');
  });

  it('refuses to look up anything that is not a 32-byte txid', async () => {
    await expect(checkTxidStatus({ txid: 'nope', network: 'Mainnet' })).rejects.toThrow(
      expect.objectContaining({ code: 'BROADCAST_MALFORMED' }),
    );
    expect(errorCode(new Error('x'))).toBe('UNEXPECTED');
  });
});

/* -------------------------------------------------------------------------- */
/* F7 — only a finalized, signed transaction is eligible for submission        */
/* -------------------------------------------------------------------------- */

/** A structurally valid legacy-serialized transaction: one input, no witness. */
const LEGACY_RAW =
  '02000000' +
  '01' +
  '11'.repeat(32) +
  '00000000' +
  '00' +
  'ffffffff' +
  '01' +
  'e803000000000000' +
  '16' +
  '0014' +
  '00'.repeat(20) +
  '00000000';

describe('F7: unsigned or stripped bytes are refused before submission', () => {
  it('decodes a legacy transaction but refuses to broadcast it', () => {
    expect(txidFromRawTransaction(LEGACY_RAW)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => assertFinalizedTransaction(LEGACY_RAW)).toThrow(
      expect.objectContaining({ code: 'BROADCAST_MALFORMED' }),
    );
  });

  it('accepts the finalized bytes of a real signed sweep', () => {
    const batch = build(3);
    const report = verifySignedPsbt(signBatch(batch), expectationFor(batch, ORDINALS.scriptHex));
    expect(report.ok).toBe(true);
    expect(report.rawTxHex).not.toBeNull();

    const tx = assertFinalizedTransaction(report.rawTxHex as string);
    expect(tx.id).toBe(report.txid);
    expect(tx.inputsLength).toBe(3);
  });

  it('rejects non-hexadecimal input', () => {
    expect(() => assertFinalizedTransaction('zzzz')).toThrow(
      expect.objectContaining({ code: 'BROADCAST_MALFORMED' }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* F8 — the wallet size fallback can be applied repeatedly                     */
/* -------------------------------------------------------------------------- */

describe('F8: a wallet payload rejection can be answered more than once', () => {
  it('re-plans the same UTXO set into a smaller batch without changing totals', () => {
    const utxos = makeUtxos(32);
    const full = planSweep({
      utxos,
      ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
      destination: OTHER.address,
      feeRateSatVb: 2n,
      network: 'Signet',
    });
    expect(full.batchCount).toBe(1);

    const halved = planSweep({
      utxos: full.batches.flatMap((batch) => batch.utxos),
      ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
      destination: OTHER.address,
      feeRateSatVb: 2n,
      network: 'Signet',
      maxInputsPerBatch: 16,
    });
    expect(halved.batchCount).toBe(2);
    expect(halved.inputCount).toBe(32);
    // The same value is swept either way; only the transaction count changes.
    expect(halved.inputSats).toBe(full.inputSats);
    expect(halved.outputSats + halved.feeSats).toBe(halved.inputSats);

    const quartered = planSweep({
      utxos: full.batches.flatMap((batch) => batch.utxos),
      ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
      destination: OTHER.address,
      feeRateSatVb: 2n,
      network: 'Signet',
      maxInputsPerBatch: 8,
    });
    expect(quartered.batchCount).toBe(4);
    expect(quartered.batchCount).toBeGreaterThan(halved.batchCount);
  });

  it('never loses an input while halving', () => {
    const utxos = makeUtxos(101);
    const plan = planSweep({
      utxos,
      ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
      destination: OTHER.address,
      feeRateSatVb: 1n,
      network: 'Signet',
      maxInputsPerBatch: 25,
    });
    const swept = plan.batches.flatMap((batch) => batch.inputOutpoints);
    expect(new Set(swept).size).toBe(101);
    expect(plan.measurements.every((m) => m.weight <= 396_000)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Artifact binding — the finalized bytes and the reviewed txid agree          */
/* -------------------------------------------------------------------------- */

describe('artifact binding', () => {
  it('reports the finalized-bytes hash matching the reviewed txid', () => {
    const batch = build(4);
    const report = verifySignedPsbt(signBatch(batch), expectationFor(batch, ORDINALS.scriptHex));
    expect(checkById(report, 'txid-raw-matches')?.ok).toBe(true);
    expect(report.txid).toBe(batch.unsignedTxid);
    expect(txidFromRawTransaction(report.rawTxHex as string)).toBe(report.txid);
  });
});
