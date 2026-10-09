import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import * as broadcast from '../src/lib/broadcast';
import { planSweep } from '../src/lib/psbt';
import { ORDINALS, OTHER_ADDRESS, makeUtxos } from './fixtures';
import { ReclaimerError } from '../src/lib/errors';

// Exercise the actual console handlers with a small deterministic hook store.
// No browser wallet, DOM, network transport or real-money signing is involved.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
const walletApi = vi.hoisted(() => ({ connect: vi.fn(), scan: vi.fn(), disconnect: vi.fn(), sign: vi.fn() }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    }];
  },
  useMemo: (calculate: () => unknown) => calculate(),
  useRef(initial: unknown) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
vi.mock('../src/lib/xverse', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/xverse')>(),
  connectXverse: walletApi.connect, scanOrdinals: walletApi.scan,
  disconnectXverse: walletApi.disconnect, signPsbt: walletApi.sign,
}));
import { Reclaimer } from '../src/components/Reclaimer';
import { ImportTransaction } from '../src/components/console/ImportTransaction';

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: { target: { value?: string; checked?: boolean } }) => void; disabled?: boolean; value?: string }>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Node;
  return [element, ...nodes(element.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node && typeof node === 'object' && 'props' in node ? text((node as Node).props.children) : '';
}
let activeRender = Reclaimer;
function render() { hooks.index = 0; return activeRender(); }
function button(label: string) {
  const found = nodes(render()).find((node) => node.type === 'button' && text(node.props.children).startsWith(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function input(label: string) {
  const field = nodes(render()).find((node) => node.type === 'label' && text(node.props.children).startsWith(label));
  if (!field) throw new Error(`Missing field: ${label}`);
  return nodes(field).find((node) => node.type === 'input')!;
}
async function click(label: string) {
  button(label).props.onClick?.();
  await vi.waitFor(() => expect(button('Reconnect Xverse').props.disabled).toBe(false));
}
const wallet = { requestedNetwork: 'Signet', walletNetwork: 'Signet', ordinals: {
  publicKey: ORDINALS.internalPubKeyHex, address: ORDINALS.address, purpose: 'ordinals', addressType: 'p2tr',
} };
const scan = { complete: true, utxos: makeUtxos(2), grossSats: 20_000n, inscriptionCount: 2, retrievedCount: 2,
  reportedTotal: 2, pagesFetched: 1, duplicateIdCount: 0, unverifiedAddressCount: 0, warnings: [], quarantine: [], truncated: false };

beforeEach(() => {
  activeRender = Reclaimer;
  hooks.slots = []; hooks.index = 0; vi.clearAllMocks();
  walletApi.connect.mockResolvedValue(wallet);
  walletApi.scan.mockResolvedValue(scan);
  walletApi.disconnect.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('console stale state and concurrent wallet actions', () => {
  it('does not sign a batch whose txid already had a submission attempt', async () => {
    await click('Connect Xverse'); await click('Scan all inscriptions');
    input('I understand').props.onChange?.({ target: { checked: true } });
    input('Destination Bitcoin').props.onChange?.({ target: { value: OTHER_ADDRESS } });
    await click('Review sweep');
    input('Signing acknowledgement').props.onChange?.({ target: { value: 'SPEND AS BTC' } });
    const sign = button('Sign + verify').props.onClick!;
    const plan = planSweep({ utxos: scan.utxos, ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
      destination: OTHER_ADDRESS, network: 'Signet', mainnetEnabled: false, feeRateSatVb: 2n });
    const state = hooks.slots.find((slot) => typeof slot === 'object' && slot !== null && 'attempted' in slot) as broadcast.BroadcastState;
    state.attempted.add(plan.batches[0].unsignedTxid);
    sign();
    expect(walletApi.sign).not.toHaveBeenCalled();
    expect(button('Submission attempted').props.disabled).toBe(true);
  });
  it('lets the owner choose individual outputs and invalidates an unsigned plan when fees change', async () => {
    await click('Connect Xverse'); await click('Scan all inscriptions');
    input('I understand').props.onChange?.({ target: { checked: true } });
    const selected = nodes(render()).find((node) => node.type === 'label' && text(node.props.children).includes(scan.utxos[0].outpoint))!;
    nodes(selected).find((node) => node.type === 'input')!.props.onChange?.({ target: { checked: false } });
    input('Destination Bitcoin').props.onChange?.({ target: { value: OTHER_ADDRESS } });
    await click('Review sweep');
    expect(text(render())).toContain('1 UTXOs → 1 Bitcoin transaction');
    input('Fee rate').props.onChange?.({ target: { value: '3' } });
    expect(text(render())).not.toContain('Pre-sign review');
  });
  it('refuses fractional fee input without sending a signing request', async () => {
    await click('Connect Xverse'); await click('Scan all inscriptions');
    input('I understand').props.onChange?.({ target: { checked: true } });
    input('Destination Bitcoin').props.onChange?.({ target: { value: OTHER_ADDRESS } });
    input('Fee rate').props.onChange?.({ target: { value: '1.5' } });
    await click('Review sweep');
    expect(text(render())).toContain('whole-number fee rate');
    expect(text(render())).not.toContain('Pre-sign review');
    expect(walletApi.sign).not.toHaveBeenCalled();
  });
  it('allows only one connect before React has rendered the disabled button', async () => {
    let resolve!: (value: unknown) => void;
    walletApi.connect.mockReturnValue(new Promise((done) => { resolve = done; }));
    const connect = button('Connect Xverse').props.onClick!;
    connect(); connect();
    expect(walletApi.connect).toHaveBeenCalledTimes(1);
    resolve(wallet);
    await vi.waitFor(() => expect(button('Reconnect Xverse').props.disabled).toBe(false));
  });
  it('clears the connected wallet and scan when the network changes', async () => {
    await click('Connect Xverse'); await click('Scan all inscriptions');
    const select = nodes(render()).find((node) => node.type === 'select')!;
    select.props.onChange?.({ target: { value: 'Testnet' } });
    expect(button('Connect Xverse').props.disabled).toBe(false);
    expect(text(render())).not.toContain(ORDINALS.address);
    expect(text(render())).not.toContain('Select all 2 UTXOs');
    expect(button('Review sweep').props.disabled).toBe(true);
  });
  it('invalidates old scan data immediately when a rescan fails', async () => {
    await click('Connect Xverse'); await click('Scan all inscriptions');
    walletApi.scan.mockRejectedValue(new ReclaimerError('WALLET_ERROR', 'Provider unavailable'));
    await click('Scan all inscriptions');
    expect(text(render())).not.toContain('Select all 2 UTXOs');
    expect(text(render())).toContain('Provider unavailable');
    expect(button('Review sweep').props.disabled).toBe(true);
  });
  it('clears local wallet data even if provider disconnect fails', async () => {
    await click('Connect Xverse'); await click('Scan all inscriptions');
    walletApi.disconnect.mockRejectedValue(new Error('Disconnect refused'));
    button('Disconnect').props.onClick?.();
    await vi.waitFor(() => expect(text(render())).toContain('Disconnect refused'));
    expect(button('Connect Xverse').props.disabled).toBe(false);
    expect(text(render())).not.toContain(ORDINALS.address);
  });
});

describe('recovery submission requires current explicit approval', () => {
  function loadRecovery() {
    const state = broadcast.createBroadcastState();
    activeRender = () => ImportTransaction({ network: 'Signet', broadcastState: state,
      authorisation: { mainnetEnabled: false, mainnetBroadcastEnabled: false, signetBroadcastEnabled: true } });
    const plan = planSweep({ utxos: makeUtxos(1), ordinals: { publicKeyHex: ORDINALS.internalPubKeyHex, address: ORDINALS.address },
      destination: OTHER_ADDRESS, network: 'Signet', mainnetEnabled: false, feeRateSatVb: 2n });
    const tx = btc.Transaction.fromPSBT(base64.decode(plan.batches[0].psbtBase64));
    tx.sign(ORDINALS.priv); tx.finalize();
    nodes(render()).find((node) => node.type === 'textarea')!.props.onChange?.({ target: { value: hex.encode(tx.extract()) } });
    button('Inspect transaction').props.onClick?.();
  }
  it('refuses a direct handler call while the checkbox and phrase are absent', () => {
    const submit = vi.spyOn(broadcast, 'broadcastRawTransaction');
    loadRecovery();
    button('Broadcast imported').props.onClick?.();
    expect(submit).not.toHaveBeenCalled();
  });
  it('clears inspection and approval when the hex is edited', () => {
    const submit = vi.spyOn(broadcast, 'broadcastRawTransaction');
    loadRecovery();
    input('I authorize broadcasting').props.onChange?.({ target: { checked: true } });
    input('Type SPEND AS BTC').props.onChange?.({ target: { value: 'SPEND AS BTC' } });
    expect(button('Broadcast imported').props.disabled).toBe(false);
    nodes(render()).find((node) => node.type === 'textarea')!.props.onChange?.({ target: { value: '00' } });
    expect(text(render())).not.toContain('Broadcast imported transaction');
    expect(submit).not.toHaveBeenCalled();
  });
  it('checks an imported txid on its selected network without submitting it', async () => {
    const submit = vi.spyOn(broadcast, 'broadcastRawTransaction');
    const lookup = vi.spyOn(broadcast, 'checkTxidStatus').mockResolvedValue({ found: false, answered: true,
      confirmed: false, blockHeight: null, endpoint: null, explorerUrl: null, detail: 'Not known; nothing submitted.' });
    loadRecovery();
    button('Check confirmation').props.onClick?.();
    await vi.waitFor(() => expect(text(render())).toContain('Not known; nothing submitted.'));
    expect(lookup).toHaveBeenCalledWith({ txid: expect.stringMatching(/^[a-f0-9]{64}$/), network: 'Signet' });
    expect(submit).not.toHaveBeenCalled();
  });
});
