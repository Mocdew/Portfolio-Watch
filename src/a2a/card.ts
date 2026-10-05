import type { Config } from '../config';

/**
 * A2A Agent Card. Advertises the capabilities that are actually implemented:
 * the `rebalance` (drift-threshold rebalancing plan) skill and the `preview`
 * (dry-run liquidation-risk) skill. The paid `negotiate` and `notify_funded`
 * skills are added here once their wire shape is reconciled against the Pokter
 * reference agent card — we do not publish a contract we have not confirmed.
 */
export function buildAgentCard(cfg: Config) {
  const url = cfg.PUBLIC_URL ?? `http://localhost:${cfg.PORT}`;
  return {
    protocolVersion: '0.2.0',
    name: 'Waterline',
    category: 'rebalancing',
    description:
      'Evidence-first portfolio rebalancing for on-chain wallets. Give it a ' +
      'wallet portfolio (holdings with amounts, prices, and target weights) and ' +
      'a drift threshold, and it returns a rebalancing plan: which assets to buy ' +
      'or sell, the exact trade sizes, the resulting turnover, and whether the ' +
      'drift band is breached at all. It also offers evidence-first ' +
      'liquidation-risk analysis for Venus Core-pool positions on BNB Smart ' +
      'Chain. Read-only: it proposes trades, executes nothing, and never moves ' +
      'funds.',
    url,
    preferredTransport: 'JSONRPC',
    version: '0.1.0-draft',
    provider: { organization: 'Waterline', url },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'rebalance',
        name: 'rebalance',
        description:
          'Drift-threshold portfolio rebalancing plan. Target: a wallet ' +
          'portfolio. Policy: rebalance only when an asset drifts from its ' +
          'target weight by more than the threshold. Output: a rebalancing ' +
          'plan. params: { portfolio: [{ symbol, amount, priceUsd, ' +
          'targetWeight (0..1; omit all for equal weight) }], driftThreshold?: ' +
          'number (fraction, default 0.05), chainId?, account? }. Returns a ' +
          'waterline.rebalance.v1 object: { portfolioValueUsd, ' +
          'rebalanceRequired, maxDriftPct, turnoverUsd, assets[{ ' +
          'currentWeightPct, targetWeightPct, driftPct, breached, action: ' +
          '"buy"|"sell"|"hold", tradeUsd, tradeAmount }], verdict, dataSources, ' +
          'assumptions, limitations, disclaimer }. Read-only: it proposes ' +
          'trades, never executes.',
        tags: ['defi', 'rebalancing', 'portfolio', 'drift-threshold', 'allocation', 'bnb-chain'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'preview',
        name: 'preview',
        description:
          'Dry-run liquidation-risk report for Venus Core-pool positions. No ' +
          'payment, no escrow, nothing executed. params: { position?: [{ ' +
          'symbol, kind: "collateral"|"borrow", amount, priceUsd, ' +
          'collateralFactor (0..1 for collateral), decimals? }], account?, ' +
          'chainId?: 56, shocks?: number[] }. Returns a waterline.report.v1 ' +
          'object: { healthFactor, liquidatable, weightedCollateralUsd, ' +
          'totalBorrowUsd, assets[], stress[], verdict, asOf, dataSources, ' +
          'assumptions, limitations, disclaimer }.',
        tags: ['defi', 'risk', 'venus', 'liquidation', 'health-factor', 'bnb-chain'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
  };
}
