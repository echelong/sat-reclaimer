import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import { ReclaimerError, errorMessage } from './errors';
import type { AppNetwork } from './types';

/**
 * Manual broadcast layer.
 *
 * This is deliberately separate from the wallet: the signed PSBT is verified
 * and finalized by `src/lib/verify.ts`, the raw transaction is re-hashed here,
 * and only then is the exact byte sequence POSTed to an independent public
 * Bitcoin API. The wallet is never asked to broadcast, and a provider that
 * times out is answered by looking the txid up — never by resubmitting.
 *
 * Nothing in this module retries, rebroadcasts or builds a replacement. Every
 * submission is one explicit user action against one verified transaction.
 */

/* -------------------------------------------------------------------------- */
/* Operator flags                                                             */
/* -------------------------------------------------------------------------- */

export const MAINNET_ENABLE_FLAG = 'NEXT_PUBLIC_ENABLE_MAINNET';
export const SIGNET_BROADCAST_BUILD_FLAG = 'NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST';
export const MAINNET_BROADCAST_BUILD_FLAG = 'NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST';

export function isFlagEnabled(rawFlag: string | undefined): boolean {
  return rawFlag === 'true';
}

export type BroadcastAuthorisation = {
  /** NEXT_PUBLIC_ENABLE_MAINNET: the operator enabled Mainnet at all. */
  mainnetEnabled: boolean;
  /** NEXT_PUBLIC_ENABLE_MAINNET_BROADCAST: a second, explicit broadcast opt-in. */
  mainnetBroadcastEnabled: boolean;
  /** NEXT_PUBLIC_ENABLE_SIGNET_BROADCAST: Testnet/Signet broadcasting. */
  signetBroadcastEnabled: boolean;
};

export function isBroadcastAuthorised(network: AppNetwork, auth: BroadcastAuthorisation): boolean {
  switch (network) {
    case 'Mainnet':
      // Enabling Mainnet for building is not enough. Real BTC only leaves the
      // wallet when a second, explicitly set flag authorizes broadcasting.
      return auth.mainnetEnabled && auth.mainnetBroadcastEnabled;
    case 'Testnet':
    case 'Signet':
      return auth.signetBroadcastEnabled;
  }
}

export function broadcastUnlockHint(network: AppNetwork): string {
  switch (network) {
    case 'Mainnet':
      return `Set ${MAINNET_BROADCAST_BUILD_FLAG}=true (with ${MAINNET_ENABLE_FLAG}=true) in .env.local and restart to unlock the manual Mainnet broadcast step.`;
    case 'Testnet':
    case 'Signet':
      return `Set ${SIGNET_BROADCAST_BUILD_FLAG}=true in .env.local and restart to unlock broadcasting on ${network}.`;
  }
}

export function assertBroadcastAuthorised(network: AppNetwork, auth: BroadcastAuthorisation): void {
  if (isBroadcastAuthorised(network, auth)) return;
  switch (network) {
    case 'Mainnet':
      if (!auth.mainnetEnabled) {
        throw new ReclaimerError(
          'BROADCAST_DISABLED',
          `Mainnet is off. ${MAINNET_ENABLE_FLAG} must be explicitly set to "true" before Mainnet can be built or broadcast.`,
        );
      }
      if (!auth.mainnetBroadcastEnabled) {
        throw new ReclaimerError(
          'BROADCAST_DISABLED',
          `Broadcasting real BTC is disabled. ${MAINNET_ENABLE_FLAG} enables building, and ${MAINNET_BROADCAST_BUILD_FLAG}=true is a separate explicit authorization required before anything is submitted to the network.`,
        );
      }
      break;
    case 'Testnet':
    case 'Signet':
      throw new ReclaimerError(
        'BROADCAST_DISABLED',
        `Broadcasting on ${network} is disabled. Set ${SIGNET_BROADCAST_BUILD_FLAG}=true to enable it.`,
      );
    default:
      throw new ReclaimerError(
        'BROADCAST_MALFORMED',
        `Refusing to broadcast on an unknown network: ${String(network)}.`,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

export type BroadcastEndpoint = {
  label: string;
  /** API root; `/tx` is appended for submission, `/tx/{txid}/status` for lookup. */
  apiBase: string;
  explorerTxUrl: (txid: string) => string;
};

export const MAINNET_BROADCAST_ENDPOINTS: readonly BroadcastEndpoint[] = [
  {
    label: 'mempool.space',
    apiBase: 'https://mempool.space/api',
    explorerTxUrl: (txid) => `https://mempool.space/tx/${txid}`,
  },
  {
    label: 'blockstream.info',
    apiBase: 'https://blockstream.info/api',
    explorerTxUrl: (txid) => `https://blockstream.info/tx/${txid}`,
  },
];

export const TESTNET_BROADCAST_ENDPOINTS: readonly BroadcastEndpoint[] = [
  {
    label: 'mempool.space testnet',
    apiBase: 'https://mempool.space/testnet/api',
    explorerTxUrl: (txid) => `https://mempool.space/testnet/tx/${txid}`,
  },
  {
    label: 'blockstream.info testnet',
    apiBase: 'https://blockstream.info/testnet/api',
    explorerTxUrl: (txid) => `https://blockstream.info/testnet/tx/${txid}`,
  },
];

export const SIGNET_BROADCAST_ENDPOINTS: readonly BroadcastEndpoint[] = [
  {
    label: 'mempool.space signet',
    apiBase: 'https://mempool.space/signet/api',
    explorerTxUrl: (txid) => `https://mempool.space/signet/tx/${txid}`,
  },
];

/**
 * A transaction must only ever be offered to endpoints for its own network.
 * Selecting the endpoint set from the transaction's network (and never from a
 * user-supplied string) is what stops a Mainnet sweep from being accidentally
 * submitted to a testnet node that would reject it, or worse, vice versa.
 */
export function endpointsForNetwork(network: AppNetwork): readonly BroadcastEndpoint[] {
  switch (network) {
    case 'Mainnet':
      return MAINNET_BROADCAST_ENDPOINTS;
    case 'Testnet':
      return TESTNET_BROADCAST_ENDPOINTS;
    case 'Signet':
      return SIGNET_BROADCAST_ENDPOINTS;
    default:
      throw new ReclaimerError(
        'BROADCAST_MALFORMED',
        `No broadcast endpoints exist for network ${String(network)}.`,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Local transaction identity                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Recompute the TXID from the raw transaction bytes. This is an independent
 * check on the artifact about to leave the machine: if the bytes that would be
 * submitted do not hash to the verified txid, nothing is submitted.
 */
export function txidFromRawTransaction(rawTxHex: string): string {
  const cleaned = rawTxHex.trim();
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    throw new ReclaimerError(
      'BROADCAST_MALFORMED',
      'Refusing to broadcast: the raw transaction is not valid hexadecimal.',
    );
  }
  try {
    return btc.Transaction.fromRaw(hex.decode(cleaned)).id;
  } catch (error) {
    throw new ReclaimerError(
      'BROADCAST_MALFORMED',
      `Refusing to broadcast: the raw transaction could not be decoded (${errorMessage(error)}).`,
      { cause: error },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Rejection classification                                                   */
/* -------------------------------------------------------------------------- */

export type RejectionReason =
  | 'already-known'
  | 'insufficient-fee'
  | 'conflicting-inputs'
  | 'missing-inputs'
  | 'policy-rejection'
  | 'mempool-full'
  | 'other';

/**
 * Bitcoin Core's reject reasons are stable strings. They are matched in order
 * of specificity so that, for example, "bad-txns-inputs-missingorspent" is
 * reported as missing inputs while "txn-mempool-conflict" is reported as a
 * conflicting spend.
 */
export function classifyRejection(nodeResponse: string): RejectionReason {
  const text = nodeResponse.toLowerCase();
  if (/already\s+(known|in\s+(the\s+)?(mempool|block|chain))|txn-already|transaction\s+already/.test(text)) {
    return 'already-known';
  }
  if (/min\s+relay\s+fee|insufficient\s+fee|fee\s+too\s+low|below\s+(the\s+)?minimum|bad-txns-insufficient-fee/.test(text)) {
    return 'insufficient-fee';
  }
  if (/conflict|double\s*spend|txn-mempool-conflict/.test(text)) {
    return 'conflicting-inputs';
  }
  if (/missing\s+inputs|inputs-missing|bad-txns-inputs-missingorspent|missingorspent/.test(text)) {
    return 'missing-inputs';
  }
  if (/non-mandatory-script-verify-flag|mandatory-script-verify|policy|dust|too\s+large|scriptpubkey/.test(text)) {
    return 'policy-rejection';
  }
  if (/mempool\s+(is\s+)?full/.test(text)) {
    return 'mempool-full';
  }
  return 'other';
}

function rejectionSentence(reason: RejectionReason): string {
  switch (reason) {
    case 'insufficient-fee':
      return 'the fee rate is below the node’s current minimum relay fee.';
    case 'conflicting-inputs':
      return 'one or more inputs conflict with another transaction the network has already seen (a conflicting or double spend).';
    case 'missing-inputs':
      return 'one or more inputs are missing, already spent, or unknown to the node.';
    case 'policy-rejection':
      return 'the node rejected it by policy (for example a non-standard or invalid script or signature).';
    case 'mempool-full':
      return 'the node’s mempool is full.';
    case 'already-known':
      return 'the node already knows this transaction.';
    default:
      return 'the node refused it for an unrecognised reason.';
  }
}

function rejectionError(
  nodeResponse: string,
  endpoint: BroadcastEndpoint,
  txid: string,
): ReclaimerError {
  const reason = classifyRejection(nodeResponse);
  return new ReclaimerError(
    'BROADCAST_REJECTED',
    `${endpoint.label} rejected transaction ${txid}: ${rejectionSentence(reason)} Nothing was broadcast by this app, and it will not submit a replacement automatically. Node response: ${nodeResponse || 'no detail returned'}`,
  );
}

function isTransportStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500 || status === 0;
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

export type BroadcastResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json?(): Promise<unknown>;
};

export type BroadcastFetchInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type BroadcastFetch = (url: string, init: BroadcastFetchInit) => Promise<BroadcastResponse>;

const DEFAULT_TIMEOUT_MS = 15_000;

const defaultFetch: BroadcastFetch = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });

async function fetchWithTimeout(
  fetcher: BroadcastFetch,
  url: string,
  init: BroadcastFetchInit,
  timeoutMs: number,
): Promise<BroadcastResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Outcomes and duplicate-click protection                                    */
/* -------------------------------------------------------------------------- */

export type BroadcastOutcome = {
  status: 'accepted' | 'already-known';
  txid: string;
  endpoint: string;
  explorerUrl: string;
  detail: string;
  /**
   * True when the submission gave an ambiguous (transport-level) answer and the
   * network confirmed the txid by lookup instead. No resubmission ever happens
   * to produce this.
   */
  recoveredAfterTimeout: boolean;
};

/**
 * Per-session broadcast ledger. An accepted transaction is recorded and never
 * submitted again, and a second click while a submission is in flight is
 * refused rather than racing a duplicate POST.
 */
export type BroadcastState = {
  inFlight: Set<string>;
  completed: Map<string, BroadcastOutcome>;
};

export function createBroadcastState(): BroadcastState {
  return { inFlight: new Set(), completed: new Map() };
}

const sharedBroadcastState = createBroadcastState();

/* -------------------------------------------------------------------------- */
/* Submission                                                                 */
/* -------------------------------------------------------------------------- */

export type BroadcastRequest = {
  /** Raw transaction hex from the independently verified, finalized PSBT. */
  rawTxHex: string;
  /** TXID computed locally from that verified PSBT. */
  txid: string;
  network: AppNetwork;
  authorisation: BroadcastAuthorisation;
  /** Must be true. Only a signed PSBT that passed local verification is broadcastable. */
  verificationPassed: boolean;
  fetchImpl?: BroadcastFetch;
  endpoints?: readonly BroadcastEndpoint[];
  timeoutMs?: number;
  state?: BroadcastState;
};

type SubmitResult =
  | { kind: 'accepted' | 'already-known'; detail: string }
  | { kind: 'transport'; detail: string };

async function submitToEndpoint(args: {
  endpoint: BroadcastEndpoint;
  rawTxHex: string;
  txid: string;
  fetcher: BroadcastFetch;
  timeoutMs: number;
}): Promise<SubmitResult> {
  const { endpoint } = args;
  let response: BroadcastResponse;
  try {
    response = await fetchWithTimeout(
      args.fetcher,
      `${endpoint.apiBase}/tx`,
      {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: args.rawTxHex,
      },
      args.timeoutMs,
    );
  } catch (error) {
    return { kind: 'transport', detail: `${endpoint.label}: ${errorMessage(error)}` };
  }

  let text = '';
  try {
    text = (await response.text()).trim();
  } catch {
    text = '';
  }

  if (response.ok) {
    const returned = text.toLowerCase();
    if (returned && returned !== args.txid) {
      throw new ReclaimerError(
        'BROADCAST_TXID_MISMATCH',
        `${endpoint.label} returned txid ${text}, which does not match the verified ${args.txid}. The response cannot be attributed to this transaction. Treat the sweep as NOT broadcast and verify the txid on an independent explorer before doing anything else.`,
      );
    }
    return {
      kind: 'accepted',
      detail: returned
        ? `${endpoint.label} accepted the transaction and returned the matching txid.`
        : `${endpoint.label} accepted the transaction (HTTP 200) without returning a txid; the locally computed txid stands.`,
    };
  }

  const reason = classifyRejection(text);
  if (reason === 'already-known') {
    return {
      kind: 'already-known',
      detail: `${endpoint.label} reports this exact transaction is already known to the network. That is not a failure: the verified transaction is already in the mempool or in a block.`,
    };
  }
  if (isTransportStatus(response.status)) {
    return {
      kind: 'transport',
      detail: `${endpoint.label} returned HTTP ${response.status}: ${text || 'no detail'}`,
    };
  }
  throw rejectionError(text, endpoint, args.txid);
}

export type TxidStatus = {
  found: boolean;
  /** True when at least one endpoint answered (found or 404), so the result is conclusive. */
  answered: boolean;
  confirmed: boolean;
  blockHeight: number | null;
  endpoint: string | null;
  explorerUrl: string | null;
  detail: string;
};

/**
 * Ask independent nodes whether they know the txid. Used after a submission
 * returned no usable answer, and on demand by the UI to track confirmation. It
 * never submits anything.
 */
export async function checkTxidStatus(args: {
  txid: string;
  network?: AppNetwork;
  endpoints?: readonly BroadcastEndpoint[];
  fetchImpl?: BroadcastFetch;
  timeoutMs?: number;
}): Promise<TxidStatus> {
  const txid = args.txid.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new ReclaimerError(
      'BROADCAST_MALFORMED',
      'Refusing to look up a txid that is not a 32-byte hexadecimal transaction id.',
    );
  }
  const endpoints = args.endpoints ?? (args.network ? endpointsForNetwork(args.network) : MAINNET_BROADCAST_ENDPOINTS);
  const fetcher = args.fetchImpl ?? defaultFetch;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let answered = false;

  for (const endpoint of endpoints) {
    let response: BroadcastResponse;
    try {
      response = await fetchWithTimeout(
        fetcher,
        `${endpoint.apiBase}/tx/${txid}/status`,
        { method: 'GET' },
        timeoutMs,
      );
    } catch {
      continue;
    }
    if (response.status === 404) {
      answered = true;
      continue;
    }
    if (!response.ok) continue;
    answered = true;
    let confirmed = false;
    let blockHeight: number | null = null;
    if (response.json) {
      try {
        const body = await response.json();
        if (typeof body === 'object' && body !== null) {
          confirmed = (body as { confirmed?: unknown }).confirmed === true;
          const height = (body as { block_height?: unknown }).block_height;
          blockHeight = typeof height === 'number' ? height : null;
        }
      } catch {
        confirmed = false;
      }
    }
    return {
      found: true,
      answered: true,
      confirmed,
      blockHeight,
      endpoint: endpoint.label,
      explorerUrl: endpoint.explorerTxUrl(txid),
      detail: confirmed
        ? `${endpoint.label} reports txid ${txid} confirmed${blockHeight === null ? '' : ` in block ${blockHeight}`}.`
        : `${endpoint.label} reports txid ${txid} is in its mempool, not yet confirmed.`,
    };
  }

  return {
    found: false,
    answered,
    confirmed: false,
    blockHeight: null,
    endpoint: null,
    explorerUrl: null,
    detail: answered
      ? `No endpoint knows txid ${txid}. It may still be propagating; check again in a moment.`
      : `The txid lookup could not be answered by any endpoint for txid ${txid}.`,
  };
}

async function attemptBroadcast(args: {
  endpoints: readonly BroadcastEndpoint[];
  rawTxHex: string;
  txid: string;
  fetcher: BroadcastFetch;
  timeoutMs: number;
}): Promise<BroadcastOutcome> {
  const transportFailures: string[] = [];

  for (const endpoint of args.endpoints) {
    const result = await submitToEndpoint({ ...args, endpoint });
    if (result.kind === 'transport') {
      transportFailures.push(result.detail);
      continue;
    }
    return {
      status: result.kind,
      txid: args.txid,
      endpoint: endpoint.label,
      explorerUrl: endpoint.explorerTxUrl(args.txid),
      detail: result.detail,
      recoveredAfterTimeout: false,
    };
  }

  // Every submission failed at the transport level. Before drawing any
  // conclusion — and certainly before resubmitting — ask the network whether
  // this exact txid is already known.
  const lookup = await checkTxidStatus({
    txid: args.txid,
    endpoints: args.endpoints,
    fetchImpl: args.fetcher,
    timeoutMs: args.timeoutMs,
  });
  if (lookup.found) {
    return {
      status: 'accepted',
      txid: args.txid,
      endpoint: lookup.endpoint ?? 'independent endpoint',
      explorerUrl: lookup.explorerUrl ?? args.endpoints[0].explorerTxUrl(args.txid),
      detail: `No submission response arrived, but ${lookup.detail} The transaction was accepted; no second submission was made.`,
      recoveredAfterTimeout: true,
    };
  }
  if (lookup.answered) {
    throw new ReclaimerError(
      'BROADCAST_UNKNOWN',
      `No endpoint accepted the submission and txid ${args.txid} is not known to any endpoint (${transportFailures.join('; ')}). The transaction may never have left this machine, or it may still be propagating. This app will not resubmit automatically: check the txid on an independent explorer and wait before deciding to try again.`,
    );
  }
  throw new ReclaimerError(
    'BROADCAST_UNREACHABLE',
    `Every broadcast endpoint failed and the txid lookup could not be completed (${transportFailures.join('; ')}). The transaction was not confirmed as submitted, and nothing was retried automatically. Check the txid before trying again.`,
  );
}

/**
 * Submit one already-verified raw transaction to independent Bitcoin nodes.
 *
 * Every gate is re-checked here rather than trusted from the UI: explicit
 * authorization, a passed verification, and raw bytes whose hash equals the
 * expected txid. The transaction is submitted at most once per session.
 */
export async function broadcastRawTransaction(request: BroadcastRequest): Promise<BroadcastOutcome> {
  const state = request.state ?? sharedBroadcastState;
  const endpoints = request.endpoints ?? endpointsForNetwork(request.network);
  const fetcher = request.fetchImpl ?? defaultFetch;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  assertBroadcastAuthorised(request.network, request.authorisation);
  if (!request.verificationPassed) {
    throw new ReclaimerError(
      'BROADCAST_DISABLED',
      'Refusing to broadcast: the signed PSBT has not passed independent local verification.',
    );
  }

  const txid = request.txid.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new ReclaimerError(
      'BROADCAST_MALFORMED',
      'Refusing to broadcast: the expected txid is not a 32-byte hexadecimal transaction id.',
    );
  }
  const rawTxHex = request.rawTxHex.trim().toLowerCase();
  const derived = txidFromRawTransaction(rawTxHex);
  if (derived !== txid) {
    throw new ReclaimerError(
      'BROADCAST_TXID_MISMATCH',
      `Refusing to broadcast: the raw transaction hashes to ${derived}, not the verified ${txid}. The submitted bytes and the verification result disagree, so nothing was sent.`,
    );
  }

  const completed = state.completed.get(txid);
  if (completed) {
    // Idempotent: an accepted transaction is never submitted a second time.
    return completed;
  }
  if (state.inFlight.has(txid)) {
    throw new ReclaimerError(
      'BROADCAST_IN_FLIGHT',
      'A broadcast of this exact transaction is already in progress. Wait for that result instead of submitting a duplicate.',
    );
  }

  state.inFlight.add(txid);
  try {
    const outcome = await attemptBroadcast({ endpoints, rawTxHex, txid, fetcher, timeoutMs });
    if (outcome.status === 'accepted' || outcome.status === 'already-known') {
      state.completed.set(txid, outcome);
    }
    return outcome;
  } finally {
    state.inFlight.delete(txid);
  }
}
