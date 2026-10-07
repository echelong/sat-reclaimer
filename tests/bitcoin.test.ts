import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import {
  APP_NETWORKS,
  MAX_FEE_RATE_SAT_VB,
  MAX_STANDARD_TX_WEIGHT,
  P2TR_KEYPATH_INPUT_WEIGHT,
  assertFeeRateAllowed,
  assertNetworkAllowed,
  deriveOrdinalTaproot,
  estimateSweepWeight,
  feeForWeight,
  isMainnetEnabled,
  normalizeOrdinalPublicKey,
  toScureNetwork,
  validateDestinationAddress,
  vsizeFor,
} from '../src/lib/bitcoin';
import { ReclaimerError } from '../src/lib/errors';
import { KEY_B_PRIV, ORDINALS, OTHER_ADDRESS, taprootFor } from './fixtures';

const MAINNET_TAPROOT = taprootFor(KEY_B_PRIV, btc.NETWORK).address;

describe('mainnet gate', () => {
  it('is closed unless the flag is exactly "true"', () => {
    expect(isMainnetEnabled(undefined)).toBe(false);
    expect(isMainnetEnabled('false')).toBe(false);
    expect(isMainnetEnabled('1')).toBe(false);
    expect(isMainnetEnabled('TRUE')).toBe(false);
    expect(isMainnetEnabled('true')).toBe(true);
  });

  it('locks mainnet and leaves test chains open', () => {
    expect(() => assertNetworkAllowed('Mainnet', false)).toThrow(
      expect.objectContaining({ code: 'MAINNET_DISABLED' }),
    );
    expect(() => assertNetworkAllowed('Mainnet', true)).not.toThrow();
    expect(() => assertNetworkAllowed('Signet', false)).not.toThrow();
    expect(() => assertNetworkAllowed('Testnet', false)).not.toThrow();
  });

  it('exposes exactly the supported networks, mainnet last', () => {
    expect(APP_NETWORKS).toEqual(['Signet', 'Testnet', 'Mainnet']);
  });

  it('maps Signet and Testnet onto the same base58/bech32 test prefixes', () => {
    expect(toScureNetwork('Signet')).toBe(toScureNetwork('Testnet'));
    expect(toScureNetwork('Mainnet')).not.toBe(toScureNetwork('Signet'));
  });
});

describe('destination validation', () => {
  it('accepts a Taproot address on the selected network', () => {
    const validated = validateDestinationAddress(OTHER_ADDRESS, 'Signet');
    expect(validated.scriptType).toBe('tr');
    expect(validated.address).toBe(OTHER_ADDRESS);
    expect(hex.encode(validated.script)).toHaveLength(68);
  });

  it('accepts a P2WPKH address, without converting it', () => {
    const p2wpkh = btc.getAddress('wpkh', hex.decode(KEY_B_PRIV), btc.TEST_NETWORK);
    const validated = validateDestinationAddress(p2wpkh, 'Signet');
    expect(validated.scriptType).toBe('wpkh');
    expect(validated.address).toBe(p2wpkh);
  });

  it('rejects a mainnet address on a test network and says why', () => {
    const error = expect(() => validateDestinationAddress(MAINNET_TAPROOT, 'Signet')).toThrow(
      expect.objectContaining({ code: 'INVALID_DESTINATION' }),
    );
    void error;
    try {
      validateDestinationAddress(MAINNET_TAPROOT, 'Signet');
    } catch (thrown) {
      expect((thrown as ReclaimerError).message).toMatch(/Mainnet address/);
      expect((thrown as ReclaimerError).message).toMatch(/never converted/);
    }
  });

  it('rejects a testnet address on mainnet and says why', () => {
    try {
      validateDestinationAddress(OTHER_ADDRESS, 'Mainnet');
    } catch (thrown) {
      expect((thrown as ReclaimerError).message).toMatch(/Testnet address/);
    }
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['not an address', 'garbage'],
    ['bc1q', 'truncated'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'mainnet p2pkh on testnet'],
    ['tb1p', 'prefix only'],
    ['tb1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', 'bad checksum'],
  ])('rejects %s (%s)', (value) => {
    expect(() => validateDestinationAddress(value, 'Signet')).toThrow(
      expect.objectContaining({ code: 'INVALID_DESTINATION' }),
    );
  });

  it('rejects embedded whitespace instead of silently trimming it', () => {
    expect(() => validateDestinationAddress(` ${OTHER_ADDRESS.slice(0, 10)} ${OTHER_ADDRESS.slice(10)}`, 'Signet')).toThrow(
      expect.objectContaining({ code: 'INVALID_DESTINATION' }),
    );
  });

  it('rejects a single-character typo in the body of the address', () => {
    const swapped = `${OTHER_ADDRESS.slice(0, -1)}${OTHER_ADDRESS.endsWith('q') ? 'p' : 'q'}`;
    expect(() => validateDestinationAddress(swapped, 'Signet')).toThrow(ReclaimerError);
  });
});

describe('ordinals public key handling', () => {
  it('accepts a 32-byte x-only key', () => {
    expect(normalizeOrdinalPublicKey(ORDINALS.internalPubKeyHex)).toHaveLength(32);
  });

  it('accepts an uppercase or 0x-prefixed key', () => {
    expect(hex.encode(normalizeOrdinalPublicKey(`0x${ORDINALS.internalPubKeyHex.toUpperCase()}`))).toBe(
      ORDINALS.internalPubKeyHex,
    );
  });

  it('strips the prefix from a 33-byte compressed key', () => {
    expect(hex.encode(normalizeOrdinalPublicKey(`02${ORDINALS.internalPubKeyHex}`))).toBe(
      ORDINALS.internalPubKeyHex,
    );
    expect(hex.encode(normalizeOrdinalPublicKey(`03${ORDINALS.internalPubKeyHex}`))).toBe(
      ORDINALS.internalPubKeyHex,
    );
  });

  it('rejects keys it cannot interpret', () => {
    for (const value of ['', 'aabb', 'zz', '04'.repeat(33), '   ']) {
      expect(() => normalizeOrdinalPublicKey(value)).toThrow(
        expect.objectContaining({ code: 'ORDINALS_KEY_INVALID' }),
      );
    }
  });
});

describe('ordinal taproot derivation', () => {
  it('derives the BIP86 output that matches the wallet address', () => {
    const taproot = deriveOrdinalTaproot({
      publicKeyHex: ORDINALS.internalPubKeyHex,
      ordinalsAddress: ORDINALS.address,
      network: 'Signet',
    });
    expect(taproot.address).toBe(ORDINALS.address);
    expect(taproot.scriptHex).toBe(ORDINALS.scriptHex);
    expect(taproot.internalPubKey).toHaveLength(32);
  });

  it('refuses an address that is not the BIP86 output of the key', () => {
    expect(() =>
      deriveOrdinalTaproot({
        publicKeyHex: ORDINALS.internalPubKeyHex,
        ordinalsAddress: OTHER_ADDRESS,
        network: 'Signet',
      }),
    ).toThrow(expect.objectContaining({ code: 'ORDINALS_KEY_MISMATCH' }));
  });

  it('refuses an address on the wrong network', () => {
    expect(() =>
      deriveOrdinalTaproot({
        publicKeyHex: ORDINALS.internalPubKeyHex,
        ordinalsAddress: MAINNET_TAPROOT,
        network: 'Signet',
      }),
    ).toThrow(ReclaimerError);
  });

  it('refuses a missing ordinal address', () => {
    expect(() =>
      deriveOrdinalTaproot({
        publicKeyHex: ORDINALS.internalPubKeyHex,
        ordinalsAddress: '  ',
        network: 'Signet',
      }),
    ).toThrow(expect.objectContaining({ code: 'ORDINALS_ADDRESS_MISSING' }));
  });

  it('refuses a non-Taproot address', () => {
    expect(() =>
      deriveOrdinalTaproot({
        publicKeyHex: ORDINALS.internalPubKeyHex,
        ordinalsAddress: btc.getAddress('wpkh', hex.decode(KEY_B_PRIV), btc.TEST_NETWORK),
        network: 'Signet',
      }),
    ).toThrow(expect.objectContaining({ code: 'ORDINALS_ADDRESS_MISSING' }));
  });
});

describe('weight and fee arithmetic', () => {
  it('matches the measured weight of a real signed transaction', () => {
    // Measurements from a locally signed 1/2/3/10-input sweep:
    // 444, 674, 904, 2514 WU.
    expect(estimateSweepWeight(1)).toBe(444);
    expect(estimateSweepWeight(2)).toBe(674);
    expect(estimateSweepWeight(3)).toBe(904);
    expect(estimateSweepWeight(10)).toBe(2514);
  });

  it('adds exactly one key-path input weight per extra input', () => {
    for (let count = 1; count < 20; count += 1) {
      expect(estimateSweepWeight(count + 1) - estimateSweepWeight(count)).toBe(
        P2TR_KEYPATH_INPUT_WEIGHT,
      );
    }
  });

  it('accounts for a different destination script length', () => {
    const taproot = estimateSweepWeight(2, 34);
    const p2wpkh = estimateSweepWeight(2, 22);
    expect(taproot - p2wpkh).toBe(4 * 12);
  });

  it('rounds the fee the way BIP141 vsize does', () => {
    expect(vsizeFor(444)).toBe(111);
    expect(vsizeFor(445)).toBe(112);
    expect(feeForWeight(2514, 2n)).toBe(1258n);
    expect(feeForWeight(444, 1n)).toBe(111n);
    expect(feeForWeight(444, 31n)).toBe(3441n);
  });

  it('never exceeds the standard weight limit for supported batch sizes', () => {
    expect(estimateSweepWeight(500)).toBeLessThanOrEqual(MAX_STANDARD_TX_WEIGHT);
    expect(estimateSweepWeight(1_000)).toBeLessThanOrEqual(MAX_STANDARD_TX_WEIGHT);
    expect(estimateSweepWeight(1_700)).toBeLessThanOrEqual(MAX_STANDARD_TX_WEIGHT);
    expect(estimateSweepWeight(1_800)).toBeGreaterThan(MAX_STANDARD_TX_WEIGHT);
  });

  it('refuses to estimate a zero-input sweep', () => {
    expect(() => estimateSweepWeight(0)).toThrow(ReclaimerError);
  });
});

describe('fee-rate ceiling', () => {
  it('accepts 1 sat/vB and the ceiling', () => {
    expect(() => assertFeeRateAllowed(1n)).not.toThrow();
    expect(() => assertFeeRateAllowed(MAX_FEE_RATE_SAT_VB)).not.toThrow();
  });

  it('rejects zero, negative and absurd fee rates', () => {
    expect(() => assertFeeRateAllowed(0n)).toThrow(
      expect.objectContaining({ code: 'INVALID_FEE_RATE' }),
    );
    expect(() => assertFeeRateAllowed(-5n)).toThrow(
      expect.objectContaining({ code: 'INVALID_FEE_RATE' }),
    );
    expect(() => assertFeeRateAllowed(MAX_FEE_RATE_SAT_VB + 1n)).toThrow(
      expect.objectContaining({ code: 'INVALID_FEE_RATE' }),
    );
  });
});
