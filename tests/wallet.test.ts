import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as btc from '@scure/btc-signer';
import { ReclaimerError } from '../src/lib/errors';
import { KEY_B_PRIV, ORDINALS, taprootFor } from './fixtures';

/**
 * The real `sats-connect` package talks to `window.XverseProviders`. These tests
 * replace it so the wallet layer can be exercised deterministically, including
 * cancellations, malformed payloads, timeouts and wrong-network responses.
 */
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('sats-connect', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  AddressPurpose: { Ordinals: 'ordinals', Payment: 'payment', Stacks: 'stacks' },
  AddressType: { p2tr: 'p2tr', p2wpkh: 'p2wpkh', p2sh: 'p2sh' },
  BitcoinNetworkType: {
    Mainnet: 'Mainnet',
    Testnet: 'Testnet',
    Testnet4: 'Testnet4',
    Signet: 'Signet',
    Regtest: 'Regtest',
  },
  RpcErrorCode: {
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    USER_REJECTION: -32000,
    METHOD_NOT_SUPPORTED: -32001,
    ACCESS_DENIED: -32002,
  },
}));

import {
  connectXverse,
  disconnectXverse,
  isWalletSizeLimitError,
  scanOrdinals,
  signPsbt,
} from '../src/lib/xverse';

const OTHER = taprootFor(KEY_B_PRIV);
const MAINNET_ORDINALS = taprootFor(
  '0000000000000000000000000000000000000000000000000000000000000003',
  btc.NETWORK,
);

type ConnectPayload = {
  status: string;
  result: {
    id: string;
    walletType: string;
    addresses: {
      address: string;
      publicKey: string;
      purpose: string;
      addressType: string;
      walletType: string;
    }[];
    network: unknown;
  };
};

function connectPayload(): ConnectPayload {
  return {
    status: 'success',
    result: {
      id: 'req-1',
      walletType: 'software',
      addresses: [
        {
          address: ORDINALS.address,
          publicKey: ORDINALS.internalPubKeyHex,
          purpose: 'ordinals',
          addressType: 'p2tr',
          walletType: 'software',
        },
        {
          address: OTHER.address,
          publicKey: OTHER.internalPubKeyHex,
          purpose: 'payment',
          addressType: 'p2tr',
          walletType: 'software',
        },
      ],
      network: {
        bitcoin: { name: 'Signet' },
        stacks: { name: 'testnet' },
        spark: { name: 'regtest' },
      },
    },
  };
}

function withBitcoinNetwork(payload: ConnectPayload, name: string): ConnectPayload {
  payload.result.network = { bitcoin: { name }, stacks: { name: 'testnet' }, spark: { name: 'regtest' } };
  return payload;
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectXverse', () => {
  it('returns the payment and Ordinals Taproot addresses and requests the right network', async () => {
    requestMock.mockResolvedValueOnce(connectPayload());

    const wallet = await connectXverse({ network: 'Signet', mainnetEnabled: false });

    expect(wallet.ordinals.address).toBe(ORDINALS.address);
    expect(wallet.payment?.address).toBe(OTHER.address);
    expect(wallet.walletNetwork).toBe('Signet');
    expect(wallet.requestedNetwork).toBe('Signet');

    const [method, params] = requestMock.mock.calls[0];
    expect(method).toBe('wallet_connect');
    expect(params).toMatchObject({ addresses: ['ordinals', 'payment'], network: 'Signet' });
    expect((params as { message: string }).message.length).toBeLessThanOrEqual(80);
  });

  it('refuses Mainnet while the code-level gate is closed', async () => {
    await expect(connectXverse({ network: 'Mainnet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'MAINNET_DISABLED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('allows Mainnet only when the flag is explicitly true', async () => {
    const payload = connectPayload();
    payload.result.addresses[0].address = MAINNET_ORDINALS.address;
    payload.result.addresses[0].publicKey = MAINNET_ORDINALS.internalPubKeyHex;
    requestMock.mockResolvedValueOnce(withBitcoinNetwork(payload, 'Mainnet'));

    const wallet = await connectXverse({ network: 'Mainnet', mainnetEnabled: true });

    expect(wallet.walletNetwork).toBe('Mainnet');
    expect(wallet.ordinals.address).toBe(MAINNET_ORDINALS.address);
  });

  it('surfaces a user cancellation distinctly', async () => {
    requestMock.mockResolvedValueOnce({
      status: 'error',
      error: { code: -32000, message: 'User rejected the request' },
    });

    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'WALLET_USER_REJECTED',
    });
  });

  it('surfaces a cancellation of the provider selector', async () => {
    requestMock.mockResolvedValueOnce({
      status: 'error',
      error: {
        code: -32603,
        message: 'Failed to select the provider. User may have cancelled the selection prompt.',
      },
    });

    const error = await connectXverse({ network: 'Signet', mainnetEnabled: false }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ReclaimerError);
    expect((error as ReclaimerError).message).toMatch(/cancelled the selection prompt/);
  });

  it('reports Xverse not being installed', async () => {
    requestMock.mockRejectedValueOnce(new Error('no wallet provider was found'));

    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'WALLET_NOT_INSTALLED',
    });
  });

  it('times out a wallet that never answers', async () => {
    vi.useFakeTimers();
    requestMock.mockImplementationOnce(() => new Promise(() => {}));

    const pending = connectXverse({ network: 'Signet', mainnetEnabled: false });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'WALLET_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    await assertion;
  });

  it('rejects a response with no address list', async () => {
    const payload = connectPayload();
    delete (payload.result as { addresses?: unknown }).addresses;
    requestMock.mockResolvedValueOnce(payload);
    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'WALLET_MALFORMED_RESPONSE',
    });
  });

  it('rejects a response without a network', async () => {
    const payload = connectPayload();
    delete (payload.result as { network?: unknown }).network;
    requestMock.mockResolvedValueOnce(payload);
    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'WALLET_MALFORMED_RESPONSE',
    });
  });

  it('rejects a truncated response object', async () => {
    requestMock.mockResolvedValueOnce({ status: 'success', result: null });
    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'WALLET_MALFORMED_RESPONSE',
    });
  });

  it('rejects an unrecognised response shape', async () => {
    requestMock.mockResolvedValueOnce({ status: 'weird' });
    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'WALLET_MALFORMED_RESPONSE',
    });
  });

  it('rejects a wallet that is on the wrong network', async () => {
    requestMock.mockResolvedValueOnce(withBitcoinNetwork(connectPayload(), 'Testnet'));

    const error = await connectXverse({ network: 'Signet', mainnetEnabled: false }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ReclaimerError);
    expect((error as ReclaimerError).code).toBe('WALLET_NETWORK_MISMATCH');
    expect((error as ReclaimerError).message).toMatch(/Switch the network in Xverse/);
  });

  it('rejects a wallet that returns no Ordinals address', async () => {
    const payload = connectPayload();
    payload.result.addresses = [payload.result.addresses[1]];
    requestMock.mockResolvedValueOnce(payload);
    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'ORDINALS_ADDRESS_MISSING',
    });
  });

  it('rejects a non-Taproot Ordinals address', async () => {
    const payload = connectPayload();
    payload.result.addresses[0].addressType = 'p2wpkh';
    requestMock.mockResolvedValueOnce(payload);
    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'ORDINALS_ADDRESS_MISSING',
    });
  });

  it('rejects an address that does not match the returned public key', async () => {
    const payload = connectPayload();
    payload.result.addresses[0].address = OTHER.address;
    requestMock.mockResolvedValueOnce(payload);
    await expect(connectXverse({ network: 'Signet', mainnetEnabled: false })).rejects.toMatchObject({
      code: 'ORDINALS_KEY_MISMATCH',
    });
  });
});

describe('disconnectXverse', () => {
  it('calls wallet_disconnect', async () => {
    requestMock.mockResolvedValueOnce({ status: 'success', result: null });
    await disconnectXverse();
    expect(requestMock.mock.calls[0][0]).toBe('wallet_disconnect');
  });
});

describe('scanOrdinals', () => {
  function inscriptionPage(count: number, total: number, address = ORDINALS.address) {
    return {
      status: 'success',
      result: {
        total,
        limit: 100,
        offset: 0,
        inscriptions: Array.from({ length: count }, (_, index) => ({
          inscriptionId: `insc-${index}`,
          inscriptionNumber: String(index),
          address,
          postage: '10000',
          contentLength: '42',
          contentType: 'image/png',
          timestamp: 1_700_000_000,
          offset: index,
          genesisTransaction: 'a'.repeat(64),
          output: `${(index + 1).toString(16).padStart(64, '0')}:0`,
        })),
      },
    };
  }

  it('reads a wallet with one inscription per UTXO', async () => {
    requestMock.mockResolvedValueOnce(inscriptionPage(3, 3));

    const result = await scanOrdinals({
      ordinalsAddress: ORDINALS.address,
      network: 'Signet',
      mainnetEnabled: false,
    });

    expect(result.inscriptionCount).toBe(3);
    expect(result.utxos).toHaveLength(3);
    expect(result.grossSats).toBe(30_000n);
    expect(result.pagesFetched).toBe(1);
  });

  it('handles an empty wallet', async () => {
    requestMock.mockResolvedValueOnce(inscriptionPage(0, 0));
    const result = await scanOrdinals({
      ordinalsAddress: ORDINALS.address,
      network: 'Signet',
      mainnetEnabled: false,
    });
    expect(result.utxos).toHaveLength(0);
    expect(result.grossSats).toBe(0n);
  });

  it('excludes inscriptions that belong to another address', async () => {
    requestMock.mockResolvedValueOnce(inscriptionPage(2, 2, OTHER.address));

    const result = await scanOrdinals({
      ordinalsAddress: ORDINALS.address,
      network: 'Signet',
      mainnetEnabled: false,
    });

    expect(result.utxos).toHaveLength(0);
    expect(result.quarantine.every((entry) => entry.reason === 'foreign-address')).toBe(true);
  });

  it('refuses Mainnet while the gate is closed', async () => {
    await expect(
      scanOrdinals({ ordinalsAddress: ORDINALS.address, network: 'Mainnet', mainnetEnabled: false }),
    ).rejects.toMatchObject({ code: 'MAINNET_DISABLED' });
  });
});

describe('signPsbt', () => {
  it('asks for exactly the given input indexes and never broadcasts', async () => {
    requestMock.mockResolvedValueOnce({ status: 'success', result: { psbt: 'cHNidP8=' } });

    const result = await signPsbt({
      psbtBase64: 'unsigned-psbt',
      ordinalsAddress: ORDINALS.address,
      inputIndexes: [0, 1, 2],
    });

    expect(result.psbt).toBe('cHNidP8=');
    const [method, params] = requestMock.mock.calls[0];
    expect(method).toBe('signPsbt');
    expect(params).toEqual({
      psbt: 'unsigned-psbt',
      signInputs: { [ORDINALS.address]: [0, 1, 2] },
      broadcast: false,
    });
  });

  it('refuses to ask for a signature with no inputs', async () => {
    await expect(
      signPsbt({ psbtBase64: 'x', ordinalsAddress: ORDINALS.address, inputIndexes: [] }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects a response with no signed PSBT', async () => {
    requestMock.mockResolvedValueOnce({ status: 'success', result: {} });
    await expect(
      signPsbt({ psbtBase64: 'x', ordinalsAddress: ORDINALS.address, inputIndexes: [0] }),
    ).rejects.toMatchObject({ code: 'WALLET_MALFORMED_RESPONSE' });
  });

  it('passes a rejection through untouched', async () => {
    requestMock.mockResolvedValueOnce({ status: 'error', error: { code: -32000, message: 'nope' } });
    await expect(
      signPsbt({ psbtBase64: 'x', ordinalsAddress: ORDINALS.address, inputIndexes: [0] }),
    ).rejects.toMatchObject({ code: 'WALLET_USER_REJECTED' });
  });

  it('still refuses a Mainnet request when the operator flag is off', async () => {
    await expect(
      signPsbt({
        psbtBase64: 'x',
        ordinalsAddress: MAINNET_ORDINALS.address,
        inputIndexes: [0],
        network: 'Mainnet',
        mainnetEnabled: false,
      }),
    ).rejects.toMatchObject({ code: 'MAINNET_DISABLED' });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('asks Xverse to sign every intended input without broadcasting', async () => {
    requestMock.mockResolvedValueOnce({ status: 'success', result: { psbt: 'cHNidP8=' } });

    const result = await signPsbt({
      psbtBase64: 'unsigned-psbt',
      ordinalsAddress: MAINNET_ORDINALS.address,
      inputIndexes: [0, 1, 2],
      network: 'Mainnet',
      mainnetEnabled: true,
    });

    expect(result.psbt).toBe('cHNidP8=');
    expect(requestMock.mock.calls[0][1]).toEqual({
      psbt: 'unsigned-psbt',
      signInputs: { [MAINNET_ORDINALS.address]: [0, 1, 2] },
      broadcast: false,
    });
  });
});

describe('wallet size-limit classification', () => {
  it('recognises payload, size and input-limit rejections', () => {
    for (const message of [
      'PSBT is too large',
      'Request payload too big',
      'exceeds maximum inputs',
      'input limit reached',
      '413 request entity too large',
      'Transaction too large for this wallet',
    ]) {
      expect(isWalletSizeLimitError(new Error(message))).toBe(true);
    }
  });

  it('does not misclassify user rejections or unrelated errors', () => {
    for (const message of [
      'User rejected the request',
      'You cancelled the request in Xverse',
      'Insufficient funds',
      'Network error',
    ]) {
      expect(isWalletSizeLimitError(new Error(message))).toBe(false);
    }
  });
});
