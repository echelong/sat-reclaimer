import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { base64 } from '@scure/base';
import {
  broadcastRawTransaction,
  checkTxidStatus,
  classifyRejection,
  createBroadcastState,
  endpointsForNetwork,
  txidFromRawTransaction,
  type BroadcastAuthorisation,
  type BroadcastFetch,
  type BroadcastFetchInit,
  type BroadcastResponse,
  type BroadcastState,
} from '../src/lib/broadcast';
import { splitIntoBatches } from '../src/lib/ordinals';
import { buildSweepBatch, expectationFor } from '../src/lib/psbt';
import { verifySignedPsbt } from '../src/lib/verify';
import type { AppNetwork } from '../src/lib/types';
import { KEY_A_PRIV, KEY_B_PRIV, ORDINALS, makeUtxos, taprootFor } from './fixtures';

/**
 * These tests exercise the manual broadcast layer with a fake transport. No
 * live endpoint is contacted and no live Mainnet transaction is created; the
 * raw transactions are locally built and signed with the deterministic test
 * key, exactly like the rest of the offline suite.
 */

const MAINNET_ORDINALS = taprootFor(KEY_A_PRIV, btc.NETWORK);
const MAINNET_DESTINATION = taprootFor(KEY_B_PRIV, btc.NETWORK).address;
const TESTNET_DESTINATION = taprootFor(KEY_B_PRIV).address;

const AUTHORISED_MAINNET: BroadcastAuthorisation = {
  mainnetEnabled: true,
  mainnetBroadcastEnabled: true,
  signetBroadcastEnabled: false,
};

const AUTHORISED_SIGNET: BroadcastAuthorisation = {
  mainnetEnabled: false,
  mainnetBroadcastEnabled: false,
  signetBroadcastEnabled: true,
};

type SignedSweep = {
  rawTxHex: string;
  txid: string;
  network: AppNetwork;
};

function signedSweep(
  options: { count?: number; feeRateSatVb?: bigint; network?: AppNetwork } = {},
): SignedSweep {
  const network = options.network ?? 'Mainnet';
  const ordinals = network === 'Mainnet' ? MAINNET_ORDINALS : ORDINALS;
  const destination = network === 'Mainnet' ? MAINNET_DESTINATION : TESTNET_DESTINATION;
  const [batch] = splitIntoBatches(makeUtxos(options.count ?? 3), { maxInputs: 500 });
  const built = buildSweepBatch({
    batch,
    ordinals: { publicKeyHex: ordinals.internalPubKeyHex, address: ordinals.address },
    destination,
    feeRateSatVb: options.feeRateSatVb ?? 2n,
    network,
    mainnetEnabled: network === 'Mainnet',
  });
  const tx = btc.Transaction.fromPSBT(base64.decode(built.psbtBase64));
  for (let index = 0; index < tx.inputsLength; index += 1) tx.signIdx(ordinals.priv, index);
  const report = verifySignedPsbt(
    base64.encode(tx.toPSBT(0)),
    expectationFor(built, ordinals.scriptHex),
  );
  if (!report.ok || !report.rawTxHex || !report.txid) {
    throw new Error(`fixture: signed sweep did not verify (${report.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')})`);
  }
  return { rawTxHex: report.rawTxHex, txid: report.txid, network };
}

type RecordedCall = { url: string; init: BroadcastFetchInit };

function recorder(handler: (call: RecordedCall) => BroadcastResponse | Promise<BroadcastResponse>) {
  const calls: RecordedCall[] = [];
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

function transportError(): never {
  throw new Error('The operation was aborted.');
}

const EXPLORER_MAINNET = `https://mempool.space/tx/`;

describe('txidFromRawTransaction', () => {
  it('recomputes the verified txid from the raw bytes', () => {
    const sweep = signedSweep();
    expect(txidFromRawTransaction(sweep.rawTxHex)).toBe(sweep.txid);
  });

  it('refuses anything that is not a full raw transaction', () => {
    expect(() => txidFromRawTransaction('not-hex')).toThrow(
      expect.objectContaining({ code: 'BROADCAST_MALFORMED' }),
    );
    expect(() => txidFromRawTransaction('abc')).toThrow(
      expect.objectContaining({ code: 'BROADCAST_MALFORMED' }),
    );
    expect(() => txidFromRawTransaction('00')).toThrow(
      expect.objectContaining({ code: 'BROADCAST_MALFORMED' }),
    );
  });
});

describe('broadcast authorization', () => {
  it('is disabled when no operator flag is set', async () => {
    const sweep = signedSweep();
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));
    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: {
          mainnetEnabled: false,
          mainnetBroadcastEnabled: false,
          signetBroadcastEnabled: false,
        },
        verificationPassed: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_DISABLED' });
    expect(calls).toHaveLength(0);
  });

  it('does not treat enabling Mainnet as authorization to broadcast real BTC', async () => {
    const sweep = signedSweep();
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));
    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: {
          mainnetEnabled: true,
          mainnetBroadcastEnabled: false,
          // A Signet flag must never unlock the Mainnet path.
          signetBroadcastEnabled: true,
        },
        verificationPassed: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_DISABLED' });
    expect(calls).toHaveLength(0);
  });

  it('requires Mainnet itself to be enabled before the broadcast flag has any effect', async () => {
    const sweep = signedSweep();
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));
    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: {
          mainnetEnabled: false,
          mainnetBroadcastEnabled: true,
          signetBroadcastEnabled: false,
        },
        verificationPassed: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_DISABLED' });
    expect(calls).toHaveLength(0);
  });

  it('keeps Signet/Testnet broadcasting off without their own flag', async () => {
    const sweep = signedSweep({ network: 'Signet' });
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));
    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: {
          mainnetEnabled: true,
          mainnetBroadcastEnabled: true,
          signetBroadcastEnabled: false,
        },
        verificationPassed: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_DISABLED' });
    expect(calls).toHaveLength(0);
  });

  it('never offers a Mainnet transaction to a testnet host, or vice versa', () => {
    const mainnet = endpointsForNetwork('Mainnet');
    const signet = endpointsForNetwork('Signet');
    const testnet = endpointsForNetwork('Testnet');
    expect(mainnet.every((endpoint) => !/testnet|signet/.test(endpoint.apiBase))).toBe(true);
    expect(signet.every((endpoint) => endpoint.apiBase.includes('signet'))).toBe(true);
    expect(testnet.every((endpoint) => endpoint.apiBase.includes('testnet'))).toBe(true);
  });
});

describe('successful broadcasts', () => {
  it('submits the verified raw transaction to Mainnet and compares the returned txid', async () => {
    const sweep = signedSweep();
    const state = createBroadcastState();
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));

    const outcome = await broadcastRawTransaction({
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      state,
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.txid).toBe(sweep.txid);
    expect(outcome.endpoint).toBe('mempool.space');
    expect(outcome.explorerUrl).toBe(`${EXPLORER_MAINNET}${sweep.txid}`);
    expect(outcome.recoveredAfterTimeout).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://mempool.space/api/tx');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe(sweep.rawTxHex);
    expect(calls[0].init.headers?.['content-type']).toBe('text/plain');
    expect(state.completed.get(sweep.txid)?.status).toBe('accepted');
  });

  it('falls back to the next endpoint when the first has a transport failure', async () => {
    const sweep = signedSweep();
    let call = 0;
    const { fetchImpl, calls } = recorder(() => {
      call += 1;
      return call === 1 ? response(503, 'upstream unavailable') : response(200, sweep.txid);
    });

    const outcome = await broadcastRawTransaction({
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      state: createBroadcastState(),
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.endpoint).toBe('blockstream.info');
    expect(calls.map((entry) => entry.url)).toEqual([
      'https://mempool.space/api/tx',
      'https://blockstream.info/api/tx',
    ]);
  });

  it('treats an already-known transaction as accepted, not as a failure', async () => {
    const sweep = signedSweep();
    const state = createBroadcastState();
    const { fetchImpl } = recorder(() =>
      response(400, 'sendrawtransaction RPC error: {"code":-27,"message":"Transaction already in block chain"}'),
    );

    const outcome = await broadcastRawTransaction({
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      state,
    });

    expect(outcome.status).toBe('already-known');
    expect(outcome.txid).toBe(sweep.txid);
    expect(state.completed.get(sweep.txid)?.status).toBe('already-known');
  });

  it('accepts HTTP 200 without a returned txid body', async () => {
    const sweep = signedSweep();
    const { fetchImpl } = recorder(() => response(200, ''));
    const outcome = await broadcastRawTransaction({
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      state: createBroadcastState(),
    });
    expect(outcome.status).toBe('accepted');
    expect(outcome.detail).toMatch(/without returning a txid/);
  });
});

describe('refusals', () => {
  it('refuses a returned txid that does not match the verified transaction', async () => {
    const sweep = signedSweep();
    const state = createBroadcastState();
    const { fetchImpl } = recorder(() => response(200, 'ab'.repeat(32)));

    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: AUTHORISED_MAINNET,
        verificationPassed: true,
        fetchImpl,
        state,
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_TXID_MISMATCH' });
    // A mismatched response is never recorded as completed.
    expect(state.completed.size).toBe(0);
  });

  it('refuses mutated bytes whose hash is not the verified txid, without any network call', async () => {
    const original = signedSweep({ count: 3, feeRateSatVb: 2n });
    const mutated = signedSweep({ count: 3, feeRateSatVb: 3n });
    const { fetchImpl, calls } = recorder(() => response(200, original.txid));

    await expect(
      broadcastRawTransaction({
        rawTxHex: mutated.rawTxHex,
        txid: original.txid,
        network: 'Mainnet',
        authorisation: AUTHORISED_MAINNET,
        verificationPassed: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_TXID_MISMATCH' });
    expect(calls).toHaveLength(0);
  });

  it('never broadcasts an incomplete transaction that failed verification', async () => {
    const sweep = signedSweep();
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));
    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: AUTHORISED_MAINNET,
        verificationPassed: false,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_DISABLED' });
    expect(calls).toHaveLength(0);
  });

  it('reports each node rejection reason accurately', async () => {
    const sweep = signedSweep();
    const cases: { body: string; code: string; pattern: RegExp }[] = [
      {
        body: 'sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met, 132 < 141"}',
        code: 'BROADCAST_REJECTED',
        pattern: /minimum relay fee/,
      },
      {
        body: 'sendrawtransaction RPC error: {"code":-26,"message":"txn-mempool-conflict"}',
        code: 'BROADCAST_REJECTED',
        pattern: /conflict/,
      },
      {
        body: 'sendrawtransaction RPC error: {"code":-25,"message":"bad-txns-inputs-missingorspent"}',
        code: 'BROADCAST_REJECTED',
        pattern: /missing, already spent/,
      },
      {
        body: 'non-mandatory-script-verify-flag (Witness program hash mismatch)',
        code: 'BROADCAST_REJECTED',
        pattern: /by policy/,
      },
    ];

    for (const entry of cases) {
      const { fetchImpl } = recorder(() => response(400, entry.body));
      const error = await broadcastRawTransaction({
        ...sweep,
        authorisation: AUTHORISED_MAINNET,
        verificationPassed: true,
        fetchImpl,
        state: createBroadcastState(),
      }).catch((thrown: unknown) => thrown);
      expect(error).toMatchObject({ code: entry.code });
      expect((error as Error).message).toMatch(entry.pattern);
    }
  });
});

describe('ambiguous responses', () => {
  it('resolves a submission timeout by looking the txid up instead of resubmitting', async () => {
    const sweep = signedSweep();
    const endpoint = endpointsForNetwork('Mainnet')[0];
    const { fetchImpl, calls } = recorder((call) => {
      if (call.init.method === 'POST') transportError();
      return response(200, JSON.stringify({ confirmed: false }));
    });

    const outcome = await broadcastRawTransaction({
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      endpoints: [endpoint],
      state: createBroadcastState(),
    });

    expect(outcome.status).toBe('accepted');
    expect(outcome.recoveredAfterTimeout).toBe(true);
    expect(outcome.detail).toMatch(/in its mempool/);
    // One POST only. The second call is a lookup, never another submission.
    expect(calls.map((entry) => entry.init.method)).toEqual(['POST', 'GET']);
    expect(calls[1].url).toBe(`https://mempool.space/api/tx/${sweep.txid}/status`);
  });

  it('recognises a confirmed transaction after an ambiguous submission', async () => {
    const sweep = signedSweep();
    const endpoint = endpointsForNetwork('Mainnet')[0];
    const { fetchImpl } = recorder((call) => {
      if (call.init.method === 'POST') transportError();
      return response(200, JSON.stringify({ confirmed: true }));
    });

    const outcome = await broadcastRawTransaction({
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      endpoints: [endpoint],
      state: createBroadcastState(),
    });
    expect(outcome.status).toBe('accepted');
    expect(outcome.recoveredAfterTimeout).toBe(true);
    expect(outcome.detail).toMatch(/confirmed/);
  });

  it('reports an unknown outcome without resubmitting when no endpoint knows the txid', async () => {
    const sweep = signedSweep();
    const endpoint = endpointsForNetwork('Mainnet')[0];
    const { fetchImpl, calls } = recorder((call) => {
      if (call.init.method === 'POST') transportError();
      return response(404, 'Transaction not found');
    });

    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: AUTHORISED_MAINNET,
        verificationPassed: true,
        fetchImpl,
        endpoints: [endpoint],
        state: createBroadcastState(),
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_UNKNOWN' });
    expect(calls.map((entry) => entry.init.method)).toEqual(['POST', 'GET']);
  });

  it('reports unreachable when nothing can be answered either way', async () => {
    const sweep = signedSweep();
    const endpoint = endpointsForNetwork('Mainnet')[0];
    const { fetchImpl } = recorder(() => transportError());

    await expect(
      broadcastRawTransaction({
        ...sweep,
        authorisation: AUTHORISED_MAINNET,
        verificationPassed: true,
        fetchImpl,
        endpoints: [endpoint],
        state: createBroadcastState(),
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_UNREACHABLE' });
  });
});

describe('duplicate submissions', () => {
  it('submits an accepted transaction only once across repeated clicks', async () => {
    const sweep = signedSweep();
    const state: BroadcastState = createBroadcastState();
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));
    const request = {
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      state,
    };

    const first = await broadcastRawTransaction(request);
    const second = await broadcastRawTransaction(request);

    expect(first.status).toBe('accepted');
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(state.completed.has(sweep.txid)).toBe(true);
  });

  it('refuses a second submission while one is still in flight', async () => {
    const sweep = signedSweep();
    let release!: (value: BroadcastResponse) => void;
    const gate = new Promise<BroadcastResponse>((resolve) => {
      release = resolve;
    });
    const { fetchImpl, calls } = recorder(() => gate);
    const request = {
      ...sweep,
      authorisation: AUTHORISED_MAINNET,
      verificationPassed: true,
      fetchImpl,
      state: createBroadcastState(),
    };

    const first = broadcastRawTransaction(request);
    await expect(broadcastRawTransaction(request)).rejects.toMatchObject({
      code: 'BROADCAST_IN_FLIGHT',
    });
    release(response(200, sweep.txid));
    const outcome = await first;

    expect(outcome.status).toBe('accepted');
    expect(calls).toHaveLength(1);
  });
});

describe('txid confirmation tracking', () => {
  it('reports a confirmed transaction with its block height', async () => {
    const sweep = signedSweep();
    const endpoint = endpointsForNetwork('Mainnet')[0];
    const { fetchImpl, calls } = recorder(() =>
      response(200, JSON.stringify({ confirmed: true, block_height: 912_345 })),
    );

    const status = await checkTxidStatus({
      txid: sweep.txid,
      endpoints: [endpoint],
      fetchImpl,
    });

    expect(status).toMatchObject({
      found: true,
      answered: true,
      confirmed: true,
      blockHeight: 912_345,
      endpoint: 'mempool.space',
    });
    expect(status.explorerUrl).toBe(`https://mempool.space/tx/${sweep.txid}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('GET');
  });

  it('reports an unconfirmed mempool transaction', async () => {
    const sweep = signedSweep();
    const endpoint = endpointsForNetwork('Mainnet')[0];
    const { fetchImpl } = recorder(() => response(200, JSON.stringify({ confirmed: false })));

    const status = await checkTxidStatus({ txid: sweep.txid, endpoints: [endpoint], fetchImpl });

    expect(status).toMatchObject({ found: true, answered: true, confirmed: false, blockHeight: null });
    expect(status.detail).toMatch(/mempool/);
  });

  it('distinguishes a conclusive not-found from an unreachable lookup', async () => {
    const sweep = signedSweep();
    const endpoint = endpointsForNetwork('Mainnet')[0];

    const notFound = recorder(() => response(404, 'Transaction not found'));
    const status = await checkTxidStatus({
      txid: sweep.txid,
      endpoints: [endpoint],
      fetchImpl: notFound.fetchImpl,
    });
    expect(status).toMatchObject({ found: false, answered: true });
    expect(status.detail).toMatch(/No endpoint knows/);

    const down = recorder(() => transportError());
    const unreachable = await checkTxidStatus({
      txid: sweep.txid,
      endpoints: [endpoint],
      fetchImpl: down.fetchImpl,
    });
    expect(unreachable).toMatchObject({ found: false, answered: false });
    expect(unreachable.detail).toMatch(/could not be answered/);
  });

  it('refuses a malformed txid', async () => {
    await expect(checkTxidStatus({ txid: 'not-a-txid' })).rejects.toMatchObject({
      code: 'BROADCAST_MALFORMED',
    });
  });
});

describe('classifyRejection', () => {
  it('maps the stable Bitcoin Core reject reasons', () => {
    expect(classifyRejection('txn-already-in-mempool')).toBe('already-known');
    expect(classifyRejection('Transaction already in block chain')).toBe('already-known');
    expect(classifyRejection('min relay fee not met')).toBe('insufficient-fee');
    expect(classifyRejection('bad-txns-insufficient-fee')).toBe('insufficient-fee');
    expect(classifyRejection('txn-mempool-conflict')).toBe('conflicting-inputs');
    expect(classifyRejection('bad-txns-inputs-missingorspent')).toBe('missing-inputs');
    expect(classifyRejection('non-mandatory-script-verify-flag (bad signature)')).toBe(
      'policy-rejection',
    );
    expect(classifyRejection('mempool is full')).toBe('mempool-full');
    expect(classifyRejection('something new')).toBe('other');
  });
});

describe('Signet broadcasting uses Signet endpoints', () => {
  it('submits to the Signet host when the Signet flag authorizes it', async () => {
    const sweep = signedSweep({ network: 'Signet' });
    const { fetchImpl, calls } = recorder(() => response(200, sweep.txid));
    const outcome = await broadcastRawTransaction({
      ...sweep,
      authorisation: AUTHORISED_SIGNET,
      verificationPassed: true,
      fetchImpl,
    });
    expect(outcome.status).toBe('accepted');
    expect(outcome.endpoint).toBe('mempool.space signet');
    expect(calls[0].url).toBe('https://mempool.space/signet/api/tx');
    expect(outcome.explorerUrl).toBe(`https://mempool.space/signet/tx/${sweep.txid}`);
  });
});
