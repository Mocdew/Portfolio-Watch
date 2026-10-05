import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { getConfig } from './config';
import { logger } from './logger';
import { handleRpc } from './rpc';
import { buildAgentCard } from './a2a/card';

export async function buildServer() {
  const cfg = getConfig();
  const app = Fastify({
    loggerInstance: logger,
    requestTimeout: cfg.RPC_TIMEOUT_MS + 2000,
    bodyLimit: 256 * 1024,
    trustProxy: cfg.TRUST_PROXY,
  });

  await app.register(rateLimit, {
    max: cfg.RATE_LIMIT_MAX,
    timeWindow: cfg.RATE_LIMIT_WINDOW,
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'waterline',
    signingReady: cfg.signingReady,
    time: new Date().toISOString(),
  }));

  app.get('/.well-known/agent-card.json', async (_req, reply) => {
    reply.header('cache-control', 'no-cache');
    return buildAgentCard(cfg);
  });

  // Friendly root so a GET on the base URL (readiness probes, humans, link
  // previews) gets a 200 with discovery info instead of a 404. The task
  // endpoint itself is POST / (JSON-RPC 2.0).
  app.get('/', async () => ({
    service: 'waterline',
    status: 'ok',
    description: 'A2A liquidation-risk agent. The task endpoint is POST / (JSON-RPC 2.0).',
    endpoints: {
      health: '/health',
      agentCard: '/.well-known/agent-card.json',
      rpc: { method: 'POST', path: '/', protocol: 'JSON-RPC 2.0' },
    },
  }));

  app.post('/', async (req) => handleRpc(req.body));

  return app;
}

async function main(): Promise<void> {
  const cfg = getConfig();
  const app = await buildServer();
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  logger.info({ port: cfg.PORT }, 'waterline listening');
}

if (require.main === module) {
  main().catch((e) => {
    logger.error({ err: e }, 'failed to start');
    process.exit(1);
  });
}
