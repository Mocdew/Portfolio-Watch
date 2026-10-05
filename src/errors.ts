export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_CONFIGURED'
  | 'UPSTREAM_RPC'
  | 'STALE_DATA'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

/** Application error carrying a stable, machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Map stable codes to JSON-RPC 2.0 error numbers (deterministic). */
export const JSONRPC_CODES: Record<ErrorCode, number> = {
  INVALID_INPUT: -32602, // Invalid params
  NOT_CONFIGURED: -32001,
  UPSTREAM_RPC: -32002,
  STALE_DATA: -32003,
  NOT_IMPLEMENTED: -32004,
  INTERNAL: -32603, // Internal error
};
