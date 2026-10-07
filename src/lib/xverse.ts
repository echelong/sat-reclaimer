'use client';

import {
  AddressPurpose,
  AddressType,
  BitcoinNetworkType,
  RpcErrorCode,
  request,
  type Params,
  type Requests,
  type Return,
  type RpcError,
  type RpcResult,
} from 'sats-connect';
import { assertNetworkAllowed, deriveOrdinalTaproot } from './bitcoin';
import { ReclaimerError, errorMessage } from './errors';
import { fetchAllInscriptions, type InscriptionsPage } from './ordinals';
import type {
  AppNetwork,
  ConnectedWallet,
  ScanResult,
  WalletAddress,
} from './types';
import { scanInscriptionUtxos, sumSats } from './ordinals';

/**
 * Thin, validated wrapper over the installed sats-connect API (4.2.1).
 *
 * Verified against the package's own type declarations:
 *   - `request(method, params)` is exported from 'sats-connect'
 *   - `wallet_connect`   params { addresses, message(<=80), network }, result { addresses, walletType, network.bitcoin.name }
 *   - `ord_getInscriptions` params { offset, limit }, result { total, limit, offset, inscriptions[] }
 *   - `signPsbt`         params { psbt, signInputs: { [address]: number[] }, broadcast }, result { psbt, txid? }
 *   - `wallet_disconnect` params null|undefined
 */

const INTERACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const READ_TIMEOUT_MS = 60 * 1000;

const CONNECT_MESSAGE = 'Connect to inspect inscription UTXOs and build a BTC sweep.';

function networkToSatsConnect(network: AppNetwork): BitcoinNetworkType {
  switch (network) {
    case 'Mainnet':
      return BitcoinNetworkType.Mainnet;
    case 'Testnet':
      return BitcoinNetworkType.Testnet;
    case 'Signet':
      return BitcoinNetworkType.Signet;
  }
}

export function networkFromSatsConnect(name: string): AppNetwork | null {
  switch (name) {
    case BitcoinNetworkType.Mainnet:
      return 'Mainnet';
    case BitcoinNetworkType.Testnet:
      return 'Testnet';
    case BitcoinNetworkType.Signet:
      return 'Signet';
    default:
      return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ReclaimerError(
          'WALLET_TIMEOUT',
          `The wallet did not answer the ${label} request within ${Math.round(ms / 1000)} seconds.`,
        ),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRpcError(value: unknown): value is RpcError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RpcError).code === 'number' &&
    typeof (value as RpcError).message === 'string'
  );
}

function mapRpcError(error: RpcError): ReclaimerError {
  switch (error.code) {
    case RpcErrorCode.USER_REJECTION:
      return new ReclaimerError(
        'WALLET_USER_REJECTED',
        `You cancelled the request in Xverse (${error.message}). Nothing was signed and nothing was broadcast.`,
        { cause: error },
      );
    case RpcErrorCode.METHOD_NOT_SUPPORTED:
      return new ReclaimerError(
        'WALLET_ERROR',
        'This Xverse version does not support the requested method. Update the wallet and try again.',
        { cause: error },
      );
    case RpcErrorCode.ACCESS_DENIED:
      return new ReclaimerError(
        'WALLET_ERROR',
        'Xverse denied the request. Reconnect the wallet and approve the permissions.',
        { cause: error },
      );
    case RpcErrorCode.INVALID_PARAMS:
      return new ReclaimerError(
        'WALLET_ERROR',
        `Xverse rejected the request parameters: ${error.message}`,
        { cause: error },
      );
    default:
      return new ReclaimerError('WALLET_ERROR', `Xverse error: ${error.message}`, { cause: error });
  }
}

function mapTransportError(error: unknown, label: string): ReclaimerError {
  if (error instanceof ReclaimerError) return error;
  const message = errorMessage(error);
  if (/no wallet provider|not found|undefined is not an object/i.test(message)) {
    return new ReclaimerError(
      'WALLET_NOT_INSTALLED',
      'No Xverse provider was found. Install the Xverse extension, or open this page inside the Xverse in-app browser.',
      { cause: error },
    );
  }
  return new ReclaimerError(
    'WALLET_ERROR',
    `The wallet ${label} request failed: ${message}`,
    { cause: error },
  );
}

/** Call a Sats Connect method with a timeout and structured error mapping. */
async function call<Method extends keyof Requests>(
  method: Method,
  params: Params<Method>,
  timeoutMs: number,
): Promise<Return<Method>> {
  let response: RpcResult<Method>;
  try {
    response = await withTimeout(request(method, params), timeoutMs, method);
  } catch (error) {
    throw mapTransportError(error, method);
  }
  if (response && response.status === 'success') return response.result;
  if (response && response.status === 'error' && isRpcError(response.error)) {
    throw mapRpcError(response.error);
  }
  throw new ReclaimerError(
    'WALLET_MALFORMED_RESPONSE',
    'The wallet returned a response this app could not interpret.',
  );
}

/* -------------------------------------------------------------------------- */
/* Connect / disconnect                                                       */
/* -------------------------------------------------------------------------- */

export async function connectXverse(args: {
  network: AppNetwork;
  mainnetEnabled: boolean;
}): Promise<ConnectedWallet> {
  assertNetworkAllowed(args.network, args.mainnetEnabled);

  const result = await call(
    'wallet_connect',
    {
      addresses: [AddressPurpose.Ordinals, AddressPurpose.Payment],
      network: networkToSatsConnect(args.network),
      message: CONNECT_MESSAGE,
    },
    INTERACTIVE_TIMEOUT_MS,
  );

  if (result === null || typeof result !== 'object') {
    throw new ReclaimerError(
      'WALLET_MALFORMED_RESPONSE',
      'Xverse returned an empty connect response.',
    );
  }
  const addresses = Array.isArray(result.addresses) ? result.addresses : null;
  if (!addresses) {
    throw new ReclaimerError(
      'WALLET_MALFORMED_RESPONSE',
      'Xverse returned no address list.',
    );
  }

  const walletNetworkName = result.network?.bitcoin?.name;
  if (typeof walletNetworkName !== 'string') {
    throw new ReclaimerError(
      'WALLET_MALFORMED_RESPONSE',
      'Xverse did not report which Bitcoin network it is on, so the app cannot confirm the network.',
    );
  }
  const walletNetwork = networkFromSatsConnect(walletNetworkName);
  if (walletNetwork !== args.network) {
    throw new ReclaimerError(
      'WALLET_NETWORK_MISMATCH',
      `Xverse is on ${walletNetworkName}. This app is set to ${args.network}. Switch the network in Xverse (or pick the matching network here) before continuing — nothing will be built on the wrong chain.`,
    );
  }

  const ordinalsRow = addresses.find((address) => address.purpose === AddressPurpose.Ordinals);
  if (!ordinalsRow) {
    throw new ReclaimerError(
      'ORDINALS_ADDRESS_MISSING',
      'Xverse did not return an Ordinals address. Add an Ordinals address to the wallet and reconnect.',
    );
  }
  if (ordinalsRow.addressType !== AddressType.p2tr) {
    throw new ReclaimerError(
      'ORDINALS_ADDRESS_MISSING',
      `The Ordinals address Xverse returned is "${ordinalsRow.addressType}", not Taproot (p2tr). Inscription UTXOs are Taproot outputs.`,
    );
  }

  const ordinals: WalletAddress = {
    address: ordinalsRow.address,
    publicKey: ordinalsRow.publicKey,
    purpose: ordinalsRow.purpose,
    addressType: ordinalsRow.addressType,
    walletType: ordinalsRow.walletType,
  };
  const paymentRow = addresses.find((address) => address.purpose === AddressPurpose.Payment);
  const payment: WalletAddress | undefined = paymentRow
    ? {
        address: paymentRow.address,
        publicKey: paymentRow.publicKey,
        purpose: paymentRow.purpose,
        addressType: paymentRow.addressType,
        walletType: paymentRow.walletType,
      }
    : undefined;

  // Fail fast: refuse to continue if the address and public key disagree, or if
  // the address is not the BIP86 Taproot output this app knows how to spend.
  deriveOrdinalTaproot({
    publicKeyHex: ordinals.publicKey,
    ordinalsAddress: ordinals.address,
    network: args.network,
  });

  return {
    walletType: result.walletType,
    requestedNetwork: args.network,
    walletNetwork: walletNetworkName,
    ordinals,
    payment,
  };
}

export async function disconnectXverse(): Promise<void> {
  await call('wallet_disconnect', undefined, READ_TIMEOUT_MS);
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                  */
/* -------------------------------------------------------------------------- */

export async function scanOrdinals(args: {
  ordinalsAddress: string;
  mainnetEnabled: boolean;
  network: AppNetwork;
}): Promise<ScanResult> {
  assertNetworkAllowed(args.network, args.mainnetEnabled);

  const pagination = await fetchAllInscriptions(async ({ offset, limit }) => {
    const page = await call('ord_getInscriptions', { offset, limit }, READ_TIMEOUT_MS);
    return page as InscriptionsPage;
  });

  const reduction = scanInscriptionUtxos(pagination.rows, {
    expectedAddress: args.ordinalsAddress,
  });

  return {
    inscriptionCount: reduction.inscriptionCount,
    utxos: reduction.utxos,
    quarantine: reduction.quarantine,
    grossSats: sumSats(reduction.utxos),
    pagesFetched: pagination.pagesFetched,
    reportedTotal: pagination.reportedTotal,
    truncated: pagination.truncated,
  };
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                    */
/* -------------------------------------------------------------------------- */

export type SignedPsbtResult = {
  psbt: string;
  txid?: string;
};

/**
 * Ask Xverse to sign exactly the given input indexes of one PSBT.
 *
 * `broadcast` is always false here: signing and broadcasting are separate user
 * actions, and nothing is ever broadcast automatically.
 */
export async function signPsbt(args: {
  psbtBase64: string;
  ordinalsAddress: string;
  inputIndexes: number[];
}): Promise<SignedPsbtResult> {
  if (args.inputIndexes.length === 0) {
    throw new ReclaimerError(
      'VERIFICATION_FAILED',
      'Refusing to request a signature with no input indexes.',
    );
  }
  const result = await call(
    'signPsbt',
    {
      psbt: args.psbtBase64,
      signInputs: { [args.ordinalsAddress]: args.inputIndexes },
      broadcast: false,
    },
    INTERACTIVE_TIMEOUT_MS,
  );

  if (!result || typeof result.psbt !== 'string' || result.psbt.length === 0) {
    throw new ReclaimerError(
      'WALLET_MALFORMED_RESPONSE',
      'Xverse returned no signed PSBT. Nothing was signed.',
    );
  }
  return { psbt: result.psbt, txid: result.txid };
}

/**
 * Broadcasting is gated behind an explicit build flag and is never available on
 * Mainnet in this milestone. The UI keeps this as its own step after local
 * verification, and it is disabled by default.
 */
export const BROADCAST_BUILD_FLAG = 'NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST';

export function isBroadcastEnabled(rawFlag: string | undefined): boolean {
  return rawFlag === 'true';
}

export function assertBroadcastAllowed(args: {
  network: AppNetwork;
  broadcastEnabled: boolean;
  verificationPassed: boolean;
}): void {
  if (args.network === 'Mainnet') {
    throw new ReclaimerError(
      'BROADCAST_DISABLED',
      'Mainnet broadcasting is locked in code for this milestone.',
    );
  }
  if (!args.broadcastEnabled) {
    throw new ReclaimerError(
      'BROADCAST_DISABLED',
      `Broadcasting is disabled. Build with ${BROADCAST_BUILD_FLAG}=true to enable Signet/Testnet broadcasting.`,
    );
  }
  if (!args.verificationPassed) {
    throw new ReclaimerError(
      'BROADCAST_DISABLED',
      'The signed PSBT must pass local verification before anything can be broadcast.',
    );
  }
}

/**
 * Broadcast an already-signed PSBT on Signet/Testnet.
 *
 * NOTE: sats-connect fuses signing and broadcasting into `signPsbt`, so this
 * path asks the wallet to sign again with `broadcast: true`. It is code-gated
 * and disabled by default; it has not been exercised against a live wallet.
 */
export async function broadcastSignedPsbt(args: {
  psbtBase64: string;
  ordinalsAddress: string;
  inputIndexes: number[];
  network: AppNetwork;
  broadcastEnabled: boolean;
  verificationPassed: boolean;
}): Promise<{ txid?: string }> {
  assertBroadcastAllowed(args);
  const result = await call(
    'signPsbt',
    {
      psbt: args.psbtBase64,
      signInputs: { [args.ordinalsAddress]: args.inputIndexes },
      broadcast: true,
    },
    INTERACTIVE_TIMEOUT_MS,
  );
  return { txid: result?.txid };
}
