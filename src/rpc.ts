import { AppError, JSONRPC_CODES } from './errors';
import { previewRequest, type PreviewInput } from './service';
import { rebalanceRequest, type RebalanceInput } from './rebalance-service';
import { logger } from './logger';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
}

function ok(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function err(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/** Handle one JSON-RPC 2.0 request object and return a response object. */
export async function handleRpc(body: unknown): Promise<object> {
  const req = body as JsonRpcRequest | null;
  const id = req?.id ?? null;

  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return err(id, -32600, 'Invalid Request: expected JSON-RPC 2.0 with a string method');
  }

  try {
    switch (req.method) {
      case 'rebalance':
      case 'rebalance_plan':
        return ok(id, rebalanceRequest((req.params ?? {}) as RebalanceInput));

      case 'preview':
      case 'analyze':
        return ok(id, await previewRequest((req.params ?? {}) as PreviewInput));

      case 'negotiate':
      case 'notify_funded':
        throw new AppError(
          'NOT_IMPLEMENTED',
          `'${req.method}' is pending finalization against the Pokter reference agent-card contract.`,
        );

      default:
        return err(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (e) {
    if (e instanceof AppError) {
      return err(id, JSONRPC_CODES[e.code], e.message, { code: e.code, details: e.data });
    }
    logger.error({ err: e }, 'unhandled RPC error');
    return err(id, -32603, 'Internal error');
  }
}
