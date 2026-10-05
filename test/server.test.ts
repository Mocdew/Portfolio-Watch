import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server';

describe('server (A2A + JSON-RPC)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves a health check', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
  });

  it('serves a 200 discovery response on GET /', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.service).toBe('waterline');
    expect(body.endpoints.agentCard).toBe('/.well-known/agent-card.json');
    expect(body.endpoints.rpc.method).toBe('POST');
  });

  it('serves the agent card with the rebalance and preview skills', async () => {
    const r = await app.inject({ method: 'GET', url: '/.well-known/agent-card.json' });
    expect(r.statusCode).toBe(200);
    const card = r.json();
    expect(card.name).toBe('Waterline');
    expect(card.category).toBe('rebalancing');
    const ids = card.skills.map((s: { id: string }) => s.id);
    expect(ids).toContain('rebalance');
    expect(ids).toContain('preview');
  });

  it('runs rebalance via JSON-RPC', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/',
      payload: {
        jsonrpc: '2.0',
        id: 10,
        method: 'rebalance',
        params: {
          portfolio: [
            { symbol: 'BNB', amount: 10, priceUsd: 600, targetWeight: 0.5 },
            { symbol: 'USDT', amount: 4000, priceUsd: 1, targetWeight: 0.5 },
          ],
          driftThreshold: 0.05,
        },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.result.schema).toBe('waterline.rebalance.v1');
    expect(body.result.rebalanceRequired).toBe(true);
    expect(body.result.turnoverUsd).toBe('1000.00');
  });

  it('runs preview via JSON-RPC', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'preview',
        params: {
          position: [
            { symbol: 'BNB', kind: 'collateral', amount: 10, priceUsd: 600, collateralFactor: 0.8 },
            { symbol: 'USDT', kind: 'borrow', amount: 2000, priceUsd: 1 },
          ],
        },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.result.healthFactor).toBe('2.4000');
    const bnb = body.result.assets.find((a: { symbol: string }) => a.symbol === 'BNB');
    expect(bnb.liquidationPriceUsd).toBe('250');
  });

  it('rejects a malformed JSON-RPC request deterministically', async () => {
    const r = await app.inject({ method: 'POST', url: '/', payload: { method: 'preview' } });
    expect(r.json().error.code).toBe(-32600);
  });

  it('reports negotiate as not yet implemented with a stable code', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/',
      payload: { jsonrpc: '2.0', id: 2, method: 'negotiate', params: {} },
    });
    expect(r.json().error.data.code).toBe('NOT_IMPLEMENTED');
  });

  it('returns method-not-found for unknown methods', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/',
      payload: { jsonrpc: '2.0', id: 3, method: 'does_not_exist' },
    });
    expect(r.json().error.code).toBe(-32601);
  });
});
