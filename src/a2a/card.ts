import type { Config } from '../config';

/**
 * Draft A2A Agent Card. It advertises only the capability that is actually
 * implemented right now: the `preview` (dry-run) skill. The paid `negotiate`
 * and `notify_funded` skills are added here once their wire shape is reconciled
 * against the Pokter reference agent card — we do not publish a contract we have
 * not confirmed.
 */
export function buildAgentCard(cfg: Config) {
  const url = cfg.PUBLIC_URL ?? `http://localhost:${cfg.PORT}`;
  return {
    protocolVersion: '0.2.0',
    name: 'Waterline',
    description:
      'Evidence-first liquidation-risk analysis for Venus Core-pool lending ' +
      'positions on BNB Smart Chain (chain 56). Give it a position (explicit ' +
      'collateral + debt legs, or an account address) and it returns the health ' +
      'factor, the exact liquidation price per asset, the % buffer, and a ' +
      'price-shock stress table — every number stamped with its on-chain source ' +
      'and block. Read-only: it executes nothing and never moves funds.',
    url,
    preferredTransport: 'JSONRPC',
    version: '0.1.0-draft',
    provider: { organization: 'Waterline', url },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'preview',
        name: 'preview',
        description:
          'Dry-run liquidation-risk report. No payment, no escrow, nothing ' +
          'executed. params: { position?: [{ symbol, kind: "collateral"|"borrow", ' +
          'amount, priceUsd, collateralFactor (0..1 for collateral), decimals? }], ' +
          'account?, chainId?: 56, shocks?: number[] }. Returns a ' +
          'waterline.report.v1 object: { healthFactor, liquidatable, ' +
          'weightedCollateralUsd, totalBorrowUsd, assets[], stress[], verdict, ' +
          'asOf, dataSources, assumptions, limitations, disclaimer }.',
        tags: ['defi', 'risk', 'venus', 'liquidation', 'health-factor', 'bnb-chain'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
  };
}
