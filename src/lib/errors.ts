/**
 * Every user-visible failure in the reclaim flow is a `ReclaimerError` with a
 * machine-readable code. Callers switch on `code`; they never parse messages.
 */
export type ReclaimerErrorCode =
  | 'MAINNET_DISABLED'
  | 'BROADCAST_DISABLED'
  | 'WALLET_NOT_INSTALLED'
  | 'WALLET_USER_REJECTED'
  | 'WALLET_TIMEOUT'
  | 'WALLET_MALFORMED_RESPONSE'
  | 'WALLET_NETWORK_MISMATCH'
  | 'WALLET_ERROR'
  | 'ORDINALS_ADDRESS_MISSING'
  | 'ORDINALS_KEY_INVALID'
  | 'ORDINALS_KEY_MISMATCH'
  | 'INVALID_DESTINATION'
  | 'INVALID_FEE_RATE'
  | 'INVALID_OUTPOINT'
  | 'INVALID_POSTAGE'
  | 'DUPLICATE_INPUT'
  | 'EMPTY_BATCH'
  | 'FEE_EXCEEDS_VALUE'
  | 'DUST_OUTPUT'
  | 'ACCOUNTING_MISMATCH'
  | 'INPUT_INDEX_MISMATCH'
  | 'WEIGHT_LIMIT_EXCEEDED'
  | 'PSBT_MALFORMED'
  | 'VERIFICATION_FAILED';

export class ReclaimerError extends Error {
  readonly code: ReclaimerErrorCode;

  constructor(code: ReclaimerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ReclaimerError';
    this.code = code;
  }
}

export function isReclaimerError(error: unknown): error is ReclaimerError {
  return error instanceof ReclaimerError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorCode(error: unknown): ReclaimerErrorCode | 'UNEXPECTED' {
  return isReclaimerError(error) ? error.code : 'UNEXPECTED';
}
