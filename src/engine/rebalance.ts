import Decimal from 'decimal.js';
import type { Evidence } from './types';

const ZERO = new Decimal(0);

const DISCLAIMER =
  'Waterline produces a read-only, point-in-time rebalancing plan. It executes ' +
  'nothing and moves no funds. The plan depends entirely on the holdings, prices, ' +
  'and target weights supplied and changes the moment any of them move. Not ' +
  'financial advice; no outcome is guaranteed.';

/** One wallet holding, normalized to human units and USD, with a target weight. */
export interface RebalanceHolding {
  symbol: string;
  amount: Decimal; // units currently held
  priceUsd: Decimal; // USD per 1 whole unit
  targetWeight: Decimal; // 0..1 target fraction of total portfolio value
}

export interface RebalanceMeta {
  account?: string;
  chainId: number;
  /** Drift band as a fraction of total value, in weight terms (e.g. 0.05 = 5 pp). */
  driftThreshold: Decimal;
  asOfBlock?: number;
  asOfTimestamp?: number;
  dataSources?: Evidence[];
}

export interface AssetPlan {
  symbol: string;
  priceUsd: string;
  amount: string; // current units held
  currentValueUsd: string;
  currentWeightPct: string;
  targetWeightPct: string;
  /** currentWeight − targetWeight, in percentage points (signed). */
  driftPct: string;
  /** True when |drift| exceeds the policy threshold. */
  breached: boolean;
  action: 'buy' | 'sell' | 'hold';
  tradeUsd: string; // + buy, − sell (0 unless a rebalance is triggered)
  tradeAmount: string; // signed, in asset units
  targetValueUsd: string;
  targetAmount: string;
}

export interface RebalancePlanReport {
  schema: 'waterline.rebalance.v1';
  account?: string;
  chainId: number;
  policy: { type: 'drift-threshold'; driftThresholdPct: string };
  portfolioValueUsd: string;
  /** True when any asset has drifted outside its band. */
  rebalanceRequired: boolean;
  maxDriftPct: string;
  /** Total USD to buy (≈ total to sell) to return to target. 0 when in band. */
  turnoverUsd: string;
  turnoverPct: string;
  assets: AssetPlan[];
  verdict: string;
  asOf: { blockNumber?: number; timestamp?: number; iso?: string };
  dataSources: Evidence[];
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
}

function fmtUsd(d: Decimal): string {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
function fmtPct(fraction: Decimal): string {
  return fraction.mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
function fmtAmount(d: Decimal): string {
  return d.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toString();
}

/**
 * Build a drift-threshold rebalancing plan. Pure and deterministic.
 *
 * Policy: a rebalance is proposed only when some asset's weight has drifted from
 * its target by more than `driftThreshold` (in weight terms). When triggered,
 * every asset is traded back to its exact target weight — a self-financing plan
 * where buys net against sells.
 */
export function rebalance(
  holdings: RebalanceHolding[],
  meta: RebalanceMeta,
): RebalancePlanReport {
  const threshold = meta.driftThreshold;
  const total = holdings.reduce((a, h) => a.plus(h.amount.mul(h.priceUsd)), ZERO);

  const rows = holdings.map((h) => {
    const value = h.amount.mul(h.priceUsd);
    const weight = total.gt(ZERO) ? value.div(total) : ZERO;
    const drift = weight.minus(h.targetWeight);
    return { h, value, weight, drift, breached: drift.abs().gt(threshold) };
  });

  const rebalanceRequired = total.gt(ZERO) && rows.some((r) => r.breached);
  const maxDrift = rows.reduce((m, r) => Decimal.max(m, r.drift.abs()), ZERO);

  let turnover = ZERO;
  const assets: AssetPlan[] = rows.map((r) => {
    const targetValue = total.mul(r.h.targetWeight);
    const price = r.h.priceUsd;
    const targetAmount = price.gt(ZERO) ? targetValue.div(price) : ZERO;
    const tradeUsd = rebalanceRequired ? targetValue.minus(r.value) : ZERO;
    const tradeAmount = price.gt(ZERO) ? tradeUsd.div(price) : ZERO;
    if (tradeUsd.gt(ZERO)) turnover = turnover.plus(tradeUsd);

    let action: 'buy' | 'sell' | 'hold' = 'hold';
    if (tradeUsd.gt(new Decimal('0.005'))) action = 'buy';
    else if (tradeUsd.lt(new Decimal('-0.005'))) action = 'sell';

    return {
      symbol: r.h.symbol,
      priceUsd: fmtUsd(price),
      amount: fmtAmount(r.h.amount),
      currentValueUsd: fmtUsd(r.value),
      currentWeightPct: fmtPct(r.weight),
      targetWeightPct: fmtPct(r.h.targetWeight),
      driftPct: fmtPct(r.drift),
      breached: r.breached,
      action,
      tradeUsd: fmtUsd(tradeUsd),
      tradeAmount: fmtAmount(tradeAmount),
      targetValueUsd: fmtUsd(targetValue),
      targetAmount: fmtAmount(targetAmount),
    };
  });

  const turnoverPct = total.gt(ZERO) ? turnover.div(total) : ZERO;

  return {
    schema: 'waterline.rebalance.v1',
    account: meta.account,
    chainId: meta.chainId,
    policy: { type: 'drift-threshold', driftThresholdPct: fmtPct(threshold) },
    portfolioValueUsd: fmtUsd(total),
    rebalanceRequired,
    maxDriftPct: fmtPct(maxDrift),
    turnoverUsd: fmtUsd(turnover),
    turnoverPct: fmtPct(turnoverPct),
    assets,
    verdict: verdict(rebalanceRequired, maxDrift, threshold, total, turnover),
    asOf: {
      blockNumber: meta.asOfBlock,
      timestamp: meta.asOfTimestamp,
      iso: meta.asOfTimestamp
        ? new Date(meta.asOfTimestamp * 1000).toISOString()
        : undefined,
    },
    dataSources: meta.dataSources ?? [],
    assumptions: [
      'Target weights are fractions of total portfolio USD value and are normalized to sum to 1.',
      'Policy is threshold-based: a rebalance is proposed only when some asset drifts from its target by more than the drift threshold (in weight percentage points).',
      'When triggered, every asset is traded back to its exact target weight (full rebalance), so buys net against sells.',
      'Prices are those supplied by the caller (or read at the stated block); USD is the accounting unit.',
    ],
    limitations: [
      'Point-in-time plan, not a live monitor; drift and prices change continuously.',
      'Ignores trading fees, slippage, spreads, gas, minimum trade sizes, and tax.',
      'Proposes trades only — it routes no orders and never moves funds.',
      'Assumes each asset is freely tradable at the supplied price in both directions.',
    ],
    disclaimer: DISCLAIMER,
  };
}

function verdict(
  required: boolean,
  maxDrift: Decimal,
  threshold: Decimal,
  total: Decimal,
  turnover: Decimal,
): string {
  if (total.lte(ZERO)) return 'Portfolio has no USD value; nothing to rebalance.';
  if (!required)
    return `In balance: max drift ${fmtPct(maxDrift)}% is within the ${fmtPct(threshold)}% threshold. No rebalance needed.`;
  return `Rebalance recommended: max drift ${fmtPct(maxDrift)}% exceeds the ${fmtPct(threshold)}% threshold. Proposed turnover $${fmtUsd(turnover)}.`;
}
