import Decimal from 'decimal.js';
import {
  rebalance,
  type RebalanceHolding,
  type RebalancePlanReport,
} from './engine/rebalance';
import { AppError } from './errors';

export interface RebalanceHoldingInput {
  symbol: string;
  amount: string | number;
  priceUsd: string | number;
  /** Target fraction of the portfolio (0..1). Optional; omit all for equal weight. */
  targetWeight?: string | number;
}

export interface RebalanceInput {
  account?: string;
  chainId?: number;
  portfolio?: RebalanceHoldingInput[];
  holdings?: RebalanceHoldingInput[]; // alias for `portfolio`
  /** Drift band as a fraction (0..1), e.g. 0.05 for 5 percentage points. */
  driftThreshold?: string | number;
}

const ONE = new Decimal(1);
const WEIGHT_SUM_TOLERANCE = new Decimal('0.01');

function toDec(v: string | number | undefined, label: string): Decimal {
  if (v === undefined || v === null || (v as unknown) === '')
    throw new AppError('INVALID_INPUT', `${label} is required`);
  try {
    const d = new Decimal(v);
    if (!d.isFinite()) throw new Error('non-finite');
    return d;
  } catch {
    throw new AppError('INVALID_INPUT', `${label} is not a valid number`);
  }
}

function hasTarget(v: unknown): boolean {
  return v !== undefined && v !== null && (v as unknown) !== '';
}

/** Validate and run a drift-threshold rebalance. No RPC, fully deterministic. */
export function rebalanceRequest(input: RebalanceInput): RebalancePlanReport {
  const list = input.portfolio ?? input.holdings;
  if (!list || list.length === 0)
    throw new AppError(
      'INVALID_INPUT',
      'Provide a non-empty `portfolio` array of holdings: [{ symbol, amount, priceUsd, targetWeight? }].',
    );
  if (list.length > 50)
    throw new AppError('INVALID_INPUT', '`portfolio` is limited to 50 holdings.');

  const threshold =
    input.driftThreshold === undefined
      ? new Decimal('0.05')
      : toDec(input.driftThreshold, 'driftThreshold');
  if (threshold.lt(0) || threshold.gt(1))
    throw new AppError(
      'INVALID_INPUT',
      '`driftThreshold` must be a fraction between 0 and 1 (e.g. 0.05 for 5%).',
    );

  const base = list.map((h, i) => {
    if (!h || typeof h.symbol !== 'string' || h.symbol.length === 0)
      throw new AppError('INVALID_INPUT', `portfolio[${i}].symbol is required`);
    const amount = toDec(h.amount, `portfolio[${i}].amount`);
    const priceUsd = toDec(h.priceUsd, `portfolio[${i}].priceUsd`);
    if (amount.lt(0) || priceUsd.lt(0))
      throw new AppError(
        'INVALID_INPUT',
        `portfolio[${i}] amount and priceUsd must be non-negative`,
      );
    return { symbol: h.symbol, amount, priceUsd };
  });

  const targets = resolveTargets(list);

  const holdings: RebalanceHolding[] = base.map((b, i) => ({
    ...b,
    targetWeight: targets[i]!,
  }));

  const chainId = input.chainId ?? 56;
  return rebalance(holdings, {
    account: input.account,
    chainId,
    driftThreshold: threshold,
    dataSources: [{ source: 'caller-supplied portfolio (dry-run / preview)', chainId }],
  });
}

/**
 * Resolve each holding's target weight. If no holding supplies one, split the
 * portfolio equally. Otherwise every holding must supply one, each in 0..1, and
 * the set must sum to ~1 — it is then normalized to sum to exactly 1.
 */
function resolveTargets(list: RebalanceHoldingInput[]): Decimal[] {
  const anyTarget = list.some((h) => hasTarget(h.targetWeight));
  if (!anyTarget) {
    const eq = ONE.div(list.length);
    return list.map(() => eq);
  }

  const weights = list.map((h, i) => {
    if (!hasTarget(h.targetWeight))
      throw new AppError(
        'INVALID_INPUT',
        `portfolio[${i}].targetWeight is required when any holding specifies one`,
      );
    const w = toDec(h.targetWeight, `portfolio[${i}].targetWeight`);
    if (w.lt(0) || w.gt(1))
      throw new AppError(
        'INVALID_INPUT',
        `portfolio[${i}].targetWeight must be a fraction between 0 and 1`,
      );
    return w;
  });

  const sum = weights.reduce((a, w) => a.plus(w), new Decimal(0));
  if (sum.lte(0))
    throw new AppError('INVALID_INPUT', '`targetWeight` values must sum to a positive number.');
  if (sum.minus(ONE).abs().gt(WEIGHT_SUM_TOLERANCE))
    throw new AppError(
      'INVALID_INPUT',
      `targetWeight values are fractions and must sum to ~1 (got ${sum.toString()}).`,
    );

  return weights.map((w) => w.div(sum)); // normalize to exactly 1
}
