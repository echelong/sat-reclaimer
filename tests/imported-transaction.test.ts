import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import {
  inspectImportedTransaction,
  normalizeRawTransactionHex,
} from '../src/lib/imported-transaction';
import { ReclaimerError } from '../src/lib/errors';
import {
  broadcastRawTransaction,
  createBroadcastState,
  txidFromRawTransaction,
  type BroadcastFetch,
  type BroadcastFetchInit,
  type BroadcastResponse,
} from '../src/lib/broadcast';
import { splitIntoBatches } from '../src/lib/ordinals';
import { buildSweepBatch, expectationFor } from '../src/lib/psbt';
import { verifySignedPsbt } from '../src/lib/verify';
import { KEY_A_PRIV, KEY_B_PRIV, ORDINALS, makeUtxos, taprootFor } from './fixtures';

const OTHER = taprootFor(KEY_B_PRIV);

function signedRaw(count = 3): { rawTxHex: string; txid: string } {
  const [batch] = splitIntoBatches(makeUtxos(count), { maxInputs: 500 });
  const built = buildSweepBatch({
    batch,
    ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
    destination: OTHER.address,
    feeRateSatVb: 2n,
    network: 'Signet',
  });
  const tx = btc.Transaction.fromPSBT(base64.decode(built.psbtBase64));
  for (let index = 0; index < tx.inputsLength; index += 1) tx.signIdx(ORDINALS.priv, index);
  const signed = base64.encode(tx.toPSBT(0));
  const report = verifySignedPsbt(signed, expectationFor(built, ORDINALS.scriptHex));
  if (!report.ok || !report.rawTxHex) throw new Error('fixture could not produce a verified transaction');
  return { rawTxHex: report.rawTxHex, txid: report.txid as string };
}

describe('raw transaction input normalization', () => {
  it('accepts whitespace, newlines and an 0x prefix', () => {
    expect(normalizeRawTransactionHex('  0xAB\nCD\tEF  ')).toBe('abcdef');
  });

  it('rejects anything that is not even-length hexadecimal', () => {
    for (const bad of ['', '   ', 'zz', 'abc']) {
      expect(() => normalizeRawTransactionHex(bad)).toThrow(ReclaimerError);
    }
  });
});

describe('inspectImportedTransaction', () => {
  it('accepts a transaction this app signed and verified', () => {
    const { rawTxHex, txid } = signedRaw(3);
    const report = inspectImportedTransaction({ rawTxHex, network: 'Signet' });

    expect(report.ok).toBe(true);
    expect(report.txid).toBe(txid);
    expect(report.inputCount).toBe(3);
    expect(report.outputCount).toBe(1);
    expect(report.signedInputCount).toBe(3);
    expect(report.outputs[0].address).toBe(OTHER.address);
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it('never invents a fee or an input total', () => {
    const { rawTxHex } = signedRaw(3);
    const report = inspectImportedTransaction({ rawTxHex, network: 'Signet' });

    // A raw transaction does not carry prevout values, so these are genuinely
    // unknown and are reported as unknown rather than guessed.
    expect(report.feeSats).toBeNull();
    expect(report.inputSats).toBeNull();
    expect(report.inputs.every((input) => input.amount === null)).toBe(true);
    expect(report.unverifiable.join(' ')).toContain('cannot be recomputed');
  });

  it('states that importing is not an approval', () => {
    const { rawTxHex } = signedRaw(1);
    const report = inspectImportedTransaction({ rawTxHex, network: 'Signet' });
    expect(report.unverifiable.join(' ')).toContain('not an approval');
  });

  it('flags a stripped transaction as unfinalized', () => {
    // A legacy-encoded transaction of the same shape has no witness data at all,
    // so nothing proves an input was ever signed.
    const noWitness = inspectImportedTransaction({
      rawTxHex:
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
        '00000000',
      network: 'Signet',
    });
    expect(noWitness.ok).toBe(false);
    expect(noWitness.checks.find((check) => check.id === 'finalized')?.ok).toBe(false);
    expect(noWitness.checks.find((check) => check.id === 'key-path-only')?.ok).toBe(false);
  });

  it('rejects a multi-output transaction as not produced by this console', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: hex.decode('22'.repeat(32)),
      index: 0,
      witnessUtxo: { script: ORDINALS.script, amount: 10_000n },
      tapInternalKey: ORDINALS.pub,
    });
    tx.addOutput({ script: OTHER.script, amount: 5_000n });
    tx.addOutput({ script: OTHER.script, amount: 4_000n });
    tx.signIdx(ORDINALS.priv, 0);
    tx.finalizeIdx(0);

    const report = inspectImportedTransaction({
      rawTxHex: hex.encode(tx.extract()),
      network: 'Signet',
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'single-output')?.ok).toBe(false);
    expect(report.unverifiable.join(' ')).toContain('single-output shape');
  });

  it('reports a script-path spend as not a key-path signature', () => {
    // A two-element witness (a 64-byte element plus a 33-byte element) is a
    // script-path spend, not the single key-path signature this app produces.
    const scriptPathRaw =
      '02000000' +
      '0001' +
      '01' +
      '33'.repeat(32) +
      '00000000' +
      '00' +
      'ffffffff' +
      '01' +
      'e803000000000000' +
      '16' +
      '0014' +
      '00'.repeat(20) +
      '02' +
      '40' +
      '11'.repeat(64) +
      '21' +
      '22'.repeat(33) +
      '00000000';

    const report = inspectImportedTransaction({ rawTxHex: scriptPathRaw, network: 'Signet' });
    expect(report.checks.find((check) => check.id === 'finalized')?.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'key-path-only')?.ok).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.inputs[0].witnessItems).toBe(2);
  });

  it('refuses bytes that are not a transaction at all', () => {
    expect(() =>
      inspectImportedTransaction({ rawTxHex: 'deadbeef', network: 'Signet' }),
    ).toThrow(ReclaimerError);
  });
});

describe('network is not recoverable from raw bytes', () => {
  it('produces the identical output script on mainnet and on a test chain', () => {
    // Bitcoin output scripts carry no network: only the address encoding does.
    // This is why the imported-transaction report states that the network cannot
    // be verified rather than claiming a detection it cannot make.
    const mainnet = taprootFor(KEY_B_PRIV, btc.NETWORK);
    const testnet = taprootFor(KEY_B_PRIV, btc.TEST_NETWORK);
    expect(mainnet.scriptHex).toBe(testnet.scriptHex);
    expect(mainnet.address).not.toBe(testnet.address);
  });

  it('accepts a signature-verified Mainnet sweep when told it is Mainnet', () => {
    const mainnetOrdinals = taprootFor(KEY_A_PRIV, btc.NETWORK);
    const mainnetDest = taprootFor(KEY_B_PRIV, btc.NETWORK);
    const [batch] = splitIntoBatches(makeUtxos(3), { maxInputs: 500 });
    const built = buildSweepBatch({
      batch,
      ordinals: { publicKeyHex: mainnetOrdinals.internalPubKeyHex, address: mainnetOrdinals.address },
      destination: mainnetDest.address,
      feeRateSatVb: 1n,
      network: 'Mainnet',
      mainnetEnabled: true,
    });
    const tx = btc.Transaction.fromPSBT(base64.decode(built.psbtBase64));
    for (let index = 0; index < tx.inputsLength; index += 1) tx.signIdx(mainnetOrdinals.priv, index);
    const signed = base64.encode(tx.toPSBT(0));
    const verified = verifySignedPsbt(
      signed,
      expectationFor(built, mainnetOrdinals.scriptHex),
    );
    expect(verified.ok).toBe(true);

    const imported = inspectImportedTransaction({
      rawTxHex: verified.rawTxHex as string,
      network: 'Mainnet',
    });
    expect(imported.ok).toBe(true);
    expect(imported.unverifiable.join(' ')).toContain('network cannot be determined');
  });
});

/**
 * Recovery safety for an interrupted session.
 *
 * A signed transaction lives in browser memory only, so a refresh loses it and
 * the user is told to export the `.hex` first. These tests cover the half of that
 * story that can be checked offline: the recovered bytes go through the same
 * broadcast layer as a built sweep, are bound to one exact txid, cannot be
 * submitted twice, and are never sent anywhere by merely being inspected.
 *
 * The import panel and the console share one `BroadcastState` instance, which is
 * what makes the once-only property hold across a recovery rather than only
 * within one flow. No live endpoint is contacted: the transport is fake.
 */
describe('recovered transaction safety', () => {
  type Call = { url: string; init: BroadcastFetchInit };

  function recorder(handler: (call: Call) => BroadcastResponse | Promise<BroadcastResponse>) {
    const calls: Call[] = [];
    const fetchImpl: BroadcastFetch = async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return handler(call);
    };
    return { fetchImpl, calls };
  }

  function response(status: number, body = ''): BroadcastResponse {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => JSON.parse(body) as unknown,
    };
  }

  const SIGNET_BROADCAST = {
    mainnetEnabled: false,
    mainnetBroadcastEnabled: false,
    signetBroadcastEnabled: true,
  };
  const NOTHING_ENABLED = {
    mainnetEnabled: false,
    mainnetBroadcastEnabled: false,
    signetBroadcastEnabled: false,
  };

  it('inspects recovered bytes without touching the network', () => {
    const { rawTxHex, txid } = signedRaw(2);
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async () => {
      networkCalls += 1;
      throw new Error('inspection must not perform I/O');
    }) as typeof fetch;

    try {
      const report = inspectImportedTransaction({ rawTxHex, network: 'Signet' });
      expect(report.ok).toBe(true);
      expect(report.txid).toBe(txid);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(networkCalls).toBe(0);
  });

  it('refuses to broadcast recovered bytes when broadcasting is disabled', async () => {
    const { rawTxHex, txid } = signedRaw(1);
    const { fetchImpl, calls } = recorder(() => response(200, txid));

    await expect(
      broadcastRawTransaction({
        rawTxHex,
        txid,
        network: 'Signet',
        authorisation: NOTHING_ENABLED,
        verificationPassed: true,
        fetchImpl,
        state: createBroadcastState(),
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_DISABLED' });

    // The refusal happens before any request is made.
    expect(calls).toHaveLength(0);
  });

  it('binds the submission to the exact authorized txid', async () => {
    const { rawTxHex } = signedRaw(1);
    const { fetchImpl, calls } = recorder(() => response(200, 'ignored'));

    await expect(
      broadcastRawTransaction({
        rawTxHex,
        txid: '00'.repeat(32),
        network: 'Signet',
        authorisation: SIGNET_BROADCAST,
        verificationPassed: true,
        fetchImpl,
        state: createBroadcastState(),
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_TXID_MISMATCH' });

    expect(calls).toHaveLength(0);
  });

  it('submits a recovered transaction at most once, across repeated recoveries', async () => {
    const { rawTxHex, txid } = signedRaw(2);
    // One ledger, exactly as `Reclaimer` passes a single instance to both the
    // sweep flow and the import panel.
    const sharedState = createBroadcastState();
    const { fetchImpl, calls } = recorder(() => response(200, txid));
    const request = {
      rawTxHex,
      txid,
      network: 'Signet' as const,
      authorisation: SIGNET_BROADCAST,
      verificationPassed: true,
      fetchImpl,
      state: sharedState,
    };

    // Re-inspect between the two submissions, as a user re-loading the file would.
    const first = await broadcastRawTransaction(request);
    const reInspected = inspectImportedTransaction({ rawTxHex, network: 'Signet' });
    expect(reInspected.txid).toBe(txid);
    const second = await broadcastRawTransaction(request);

    expect(first.status).toBe('accepted');
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(sharedState.completed.has(txid)).toBe(true);
  });

  it('derives a stable txid so an approval cannot transfer to other bytes', () => {
    const { rawTxHex, txid } = signedRaw(2);

    // Whitespace, an 0x prefix and upper case are the same bytes, so one
    // acknowledgement covers all of them.
    const reordered = inspectImportedTransaction({
      rawTxHex: `  0x${rawTxHex.toUpperCase()}\n`,
      network: 'Signet',
    });
    expect(reordered.txid).toBe(txid);

    // Changing a single byte of the previous-output reference produces a
    // different txid, so an approval for one transaction can never authorise
    // another. Byte 7 — hex characters 14 and 15 — is the first byte of the
    // first input's prevout txid, so the structure stays valid and only the
    // identity changes.
    const flipped = `${rawTxHex.slice(0, 14)}${rawTxHex[14] === '0' ? '1' : '0'}${rawTxHex.slice(15)}`;
    expect(flipped).not.toBe(rawTxHex);
    expect(flipped).toHaveLength(rawTxHex.length);
    expect(txidFromRawTransaction(flipped)).not.toBe(txid);
  });
});
